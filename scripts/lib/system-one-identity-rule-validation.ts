export type IdentityValidationAssetClass = "verified_transcript_candidate" | "recording" | "ai_notes" | "other_document" | "unknown";

export type IdentityValidationAsset = {
  opaque_asset_id: string;
  opaque_parent_ids: string[];
  opaque_ancestor_ids: string[];
  normalized_basename_hash: string | null;
  opaque_shortcut_target_id: string | null;
  created_time_ms: number | null;
  property_fingerprints: string[];
  app_property_fingerprints: string[];
  asset_class: IdentityValidationAssetClass;
  eligible_for_analysis: boolean;
};

export type IdentityCandidatePair = {
  group_key: string;
  transcript_asset_id: string;
  recording_asset_id: string;
  created_time_delta_ms: number;
  independent_metadata_evidence: boolean;
};

type CandidateGroup = {
  key: string;
  members: IdentityValidationAsset[];
  transcripts: IdentityValidationAsset[];
  recordings: IdentityValidationAsset[];
  competitive: boolean;
  distantCollision: boolean;
  clusterByAssetId: Map<string, number>;
};

type RuleEvaluation = {
  CANDIDATE_GROUPS: number;
  CANDIDATE_PAIRS: number;
  AMBIGUOUS_GROUPS: number;
  UNMATCHED_GROUPS: number;
  COMPETITIVE_GROUPS_MERGED: number;
  COMPETITIVE_GROUPS_REJECTED: number;
  DISTANT_COLLISIONS_MERGED: number;
  DISTANT_COLLISIONS_REJECTED: number;
  POTENTIAL_FALSE_MERGES: number;
  candidate_pairs: IdentityCandidatePair[];
  candidate_group_keys: string[];
  ambiguous_group_keys: string[];
};

export type IdentityRuleComparison = {
  KNOWN_INDEPENDENT_POSITIVE_CONTROLS: number;
  KNOWN_COMPETITIVE_GROUPS: number;
  KNOWN_DISTANT_COLLISION_GROUPS: number;
  rules: {
    A_EXACT_CREATED_TIME: RuleEvaluation;
    B_PRIOR_CANDIDATE_P95_CIRCULAR_NOT_GROUND_TRUTH: RuleEvaluation;
    C_TRUE_MUTUAL_NEAREST_NEIGHBOR: RuleEvaluation;
    D_MNN_PLUS_INDEPENDENT_METADATA: RuleEvaluation;
  };
};

const DAY_MS = 24 * 60 * 60 * 1_000;
export const PRIOR_TRANSCRIPT_RECORDING_P95_MS = 6_496_256;

function candidateGroupKey(asset: IdentityValidationAsset): string | null {
  if (asset.opaque_parent_ids.length !== 1 || !asset.normalized_basename_hash) return null;
  return `${asset.opaque_parent_ids[0]}:${asset.normalized_basename_hash}`;
}

function isVerifiedTranscript(asset: IdentityValidationAsset): boolean {
  return asset.asset_class === "verified_transcript_candidate" && asset.eligible_for_analysis;
}

function relevantForAssociation(asset: IdentityValidationAsset): boolean {
  return isVerifiedTranscript(asset) || asset.asset_class === "recording";
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sharedFingerprint(left: string[], right: string[]): boolean {
  const rightSet = new Set(right);
  return left.some((value) => rightSet.has(value));
}

function metadataEvidence(left: IdentityValidationAsset, right: IdentityValidationAsset): {
  conflict: boolean;
  independent: boolean;
} {
  const propertyComparable = left.property_fingerprints.length > 0 && right.property_fingerprints.length > 0;
  const appPropertyComparable = left.app_property_fingerprints.length > 0 && right.app_property_fingerprints.length > 0;
  const propertyAgreement = propertyComparable ? sharedFingerprint(left.property_fingerprints, right.property_fingerprints) : false;
  const appPropertyAgreement = appPropertyComparable ? sharedFingerprint(left.app_property_fingerprints, right.app_property_fingerprints) : false;
  const shortcutRelation = left.opaque_shortcut_target_id === right.opaque_asset_id
    || right.opaque_shortcut_target_id === left.opaque_asset_id;
  return {
    conflict: (propertyComparable && !propertyAgreement) || (appPropertyComparable && !appPropertyAgreement),
    independent: shortcutRelation || propertyAgreement || appPropertyAgreement,
  };
}

function createdDelta(left: IdentityValidationAsset, right: IdentityValidationAsset): number | null {
  if (left.created_time_ms === null || right.created_time_ms === null) return null;
  return Math.abs(left.created_time_ms - right.created_time_ms);
}

function clustersForGroup(members: IdentityValidationAsset[]): Map<string, number> {
  const dated = members
    .filter((asset) => asset.created_time_ms !== null)
    .sort((left, right) => left.created_time_ms! - right.created_time_ms! || left.opaque_asset_id.localeCompare(right.opaque_asset_id));
  const clusters = new Map<string, number>();
  let cluster = 0;
  let prior: number | null = null;
  for (const asset of dated) {
    if (prior !== null && asset.created_time_ms! - prior > DAY_MS) cluster += 1;
    clusters.set(asset.opaque_asset_id, cluster);
    prior = asset.created_time_ms!;
  }
  return clusters;
}

function buildCandidateGroups(assets: IdentityValidationAsset[]): CandidateGroup[] {
  const grouped = new Map<string, IdentityValidationAsset[]>();
  for (const asset of assets.filter(relevantForAssociation)) {
    const key = candidateGroupKey(asset);
    if (!key) continue;
    const group = grouped.get(key) ?? [];
    group.push(asset);
    grouped.set(key, group);
  }
  return [...grouped.entries()].map(([key, members]) => {
    const ordered = [...members].sort((left, right) => left.opaque_asset_id.localeCompare(right.opaque_asset_id));
    const transcripts = ordered.filter(isVerifiedTranscript);
    const recordings = ordered.filter((asset) => asset.asset_class === "recording");
    const clusterByAssetId = clustersForGroup([...transcripts, ...recordings]);
    const clusterCount = new Set(clusterByAssetId.values()).size;
    return {
      key,
      members: ordered,
      transcripts,
      recordings,
      competitive: transcripts.length > 1 || recordings.length > 1,
      distantCollision: (transcripts.length > 1 || recordings.length > 1) && clusterCount > 1,
      clusterByAssetId,
    };
  }).sort((left, right) => left.key.localeCompare(right.key));
}

function uniqueNearest(source: IdentityValidationAsset, targets: IdentityValidationAsset[]): {
  target: IdentityValidationAsset | null;
  tie: boolean;
  delta: number | null;
} {
  const ranked = targets
    .map((target) => ({ target, delta: createdDelta(source, target) }))
    .filter((item): item is { target: IdentityValidationAsset; delta: number } => item.delta !== null)
    .sort((left, right) => left.delta - right.delta || left.target.opaque_asset_id.localeCompare(right.target.opaque_asset_id));
  if (ranked.length === 0) return { target: null, tie: false, delta: null };
  const minimum = ranked[0].delta;
  if (ranked.filter((item) => item.delta === minimum).length !== 1) return { target: null, tie: true, delta: minimum };
  return { target: ranked[0].target, tie: false, delta: minimum };
}

function trueMnnForGroup(group: CandidateGroup): { pairs: IdentityCandidatePair[]; ambiguous: boolean } {
  if (group.transcripts.length === 0 || group.recordings.length === 0) return { pairs: [], ambiguous: false };
  const transcriptNearest = new Map<string, ReturnType<typeof uniqueNearest>>();
  const recordingNearest = new Map<string, ReturnType<typeof uniqueNearest>>();
  let ambiguous = false;
  for (const transcript of group.transcripts) {
    const nearest = uniqueNearest(transcript, group.recordings);
    transcriptNearest.set(transcript.opaque_asset_id, nearest);
    ambiguous ||= nearest.tie;
  }
  for (const recording of group.recordings) {
    const nearest = uniqueNearest(recording, group.transcripts);
    recordingNearest.set(recording.opaque_asset_id, nearest);
    ambiguous ||= nearest.tie;
  }
  const pairs: IdentityCandidatePair[] = [];
  for (const transcript of group.transcripts) {
    const nearestRecording = transcriptNearest.get(transcript.opaque_asset_id)!;
    if (!nearestRecording.target || nearestRecording.tie || nearestRecording.delta === null) continue;
    const recording = nearestRecording.target;
    const nearestTranscript = recordingNearest.get(recording.opaque_asset_id)!;
    if (nearestTranscript.tie || nearestTranscript.target?.opaque_asset_id !== transcript.opaque_asset_id) continue;
    const metadata = metadataEvidence(transcript, recording);
    if (metadata.conflict) {
      ambiguous = true;
      continue;
    }
    pairs.push({
      group_key: group.key,
      transcript_asset_id: transcript.opaque_asset_id,
      recording_asset_id: recording.opaque_asset_id,
      created_time_delta_ms: nearestRecording.delta,
      independent_metadata_evidence: metadata.independent,
    });
  }
  return {
    pairs: pairs.sort((left, right) => left.transcript_asset_id.localeCompare(right.transcript_asset_id)
      || left.recording_asset_id.localeCompare(right.recording_asset_id)),
    ambiguous,
  };
}

function pairCrossesDistantClusters(pair: IdentityCandidatePair, group: CandidateGroup): boolean {
  if (!group.distantCollision) return false;
  return group.clusterByAssetId.get(pair.transcript_asset_id) !== group.clusterByAssetId.get(pair.recording_asset_id);
}

function ruleEvaluation(groups: CandidateGroup[], resolve: (group: CandidateGroup) => { pairs: IdentityCandidatePair[]; ambiguous: boolean }): RuleEvaluation {
  const candidatePairs: IdentityCandidatePair[] = [];
  const candidateGroups = new Set<string>();
  const ambiguousGroups = new Set<string>();
  const mergedCompetitiveGroups = new Set<string>();
  const mergedDistantGroups = new Set<string>();
  for (const group of groups) {
    const result = resolve(group);
    if (result.ambiguous) ambiguousGroups.add(group.key);
    for (const pair of result.pairs) {
      candidatePairs.push(pair);
      candidateGroups.add(group.key);
      if (group.competitive) mergedCompetitiveGroups.add(group.key);
      if (pairCrossesDistantClusters(pair, group)) mergedDistantGroups.add(group.key);
    }
  }
  const competitiveGroups = new Set(groups.filter((group) => group.competitive).map((group) => group.key));
  const distantGroups = new Set(groups.filter((group) => group.distantCollision).map((group) => group.key));
  return {
    CANDIDATE_GROUPS: candidateGroups.size,
    CANDIDATE_PAIRS: candidatePairs.length,
    AMBIGUOUS_GROUPS: ambiguousGroups.size,
    UNMATCHED_GROUPS: groups.length - candidateGroups.size - ambiguousGroups.size,
    COMPETITIVE_GROUPS_MERGED: mergedCompetitiveGroups.size,
    COMPETITIVE_GROUPS_REJECTED: competitiveGroups.size - mergedCompetitiveGroups.size,
    DISTANT_COLLISIONS_MERGED: mergedDistantGroups.size,
    DISTANT_COLLISIONS_REJECTED: distantGroups.size - mergedDistantGroups.size,
    POTENTIAL_FALSE_MERGES: mergedDistantGroups.size,
    candidate_pairs: candidatePairs.sort((left, right) => left.group_key.localeCompare(right.group_key)
      || left.transcript_asset_id.localeCompare(right.transcript_asset_id)
      || left.recording_asset_id.localeCompare(right.recording_asset_id)),
    candidate_group_keys: sortedUnique(candidateGroups),
    ambiguous_group_keys: sortedUnique(ambiguousGroups),
  };
}

function oneToOnePair(group: CandidateGroup, predicate: (transcript: IdentityValidationAsset, recording: IdentityValidationAsset) => boolean): {
  pairs: IdentityCandidatePair[];
  ambiguous: boolean;
} {
  if (group.transcripts.length !== 1 || group.recordings.length !== 1) return { pairs: [], ambiguous: false };
  const [transcript] = group.transcripts;
  const [recording] = group.recordings;
  const delta = createdDelta(transcript, recording);
  const metadata = metadataEvidence(transcript, recording);
  if (delta === null || metadata.conflict) return { pairs: [], ambiguous: metadata.conflict };
  if (!predicate(transcript, recording)) return { pairs: [], ambiguous: false };
  return {
    pairs: [{
      group_key: group.key,
      transcript_asset_id: transcript.opaque_asset_id,
      recording_asset_id: recording.opaque_asset_id,
      created_time_delta_ms: delta,
      independent_metadata_evidence: metadata.independent,
    }],
    ambiguous: false,
  };
}

function independentPositiveControls(groups: CandidateGroup[]): number {
  const controls = new Set<string>();
  for (const group of groups) {
    for (const transcript of group.transcripts) {
      for (const recording of group.recordings) {
        const metadata = metadataEvidence(transcript, recording);
        if (!metadata.conflict && metadata.independent) controls.add(`${group.key}:${transcript.opaque_asset_id}:${recording.opaque_asset_id}`);
      }
    }
  }
  return controls.size;
}

export function evaluateIdentityRuleComparison(assets: IdentityValidationAsset[]): IdentityRuleComparison {
  const groups = buildCandidateGroups(assets);
  const trueMnn = ruleEvaluation(groups, trueMnnForGroup);
  return {
    KNOWN_INDEPENDENT_POSITIVE_CONTROLS: independentPositiveControls(groups),
    KNOWN_COMPETITIVE_GROUPS: groups.filter((group) => group.competitive).length,
    KNOWN_DISTANT_COLLISION_GROUPS: groups.filter((group) => group.distantCollision).length,
    rules: {
      A_EXACT_CREATED_TIME: ruleEvaluation(groups, (group) => oneToOnePair(group, (transcript, recording) => transcript.created_time_ms === recording.created_time_ms)),
      B_PRIOR_CANDIDATE_P95_CIRCULAR_NOT_GROUND_TRUTH: ruleEvaluation(groups, (group) => oneToOnePair(group, (transcript, recording) => {
        const delta = createdDelta(transcript, recording);
        return delta !== null && delta <= PRIOR_TRANSCRIPT_RECORDING_P95_MS;
      })),
      C_TRUE_MUTUAL_NEAREST_NEIGHBOR: trueMnn,
      D_MNN_PLUS_INDEPENDENT_METADATA: ruleEvaluation(groups, (group) => {
        const result = trueMnnForGroup(group);
        return {
          pairs: result.pairs.filter((pair) => pair.independent_metadata_evidence),
          ambiguous: result.ambiguous,
        };
      }),
    },
  };
}
