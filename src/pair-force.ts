export interface PairForceParams {
  dist: number;
  bodyRadius: number;
  interactionRange: number;
  stickiness: number;
  stiffness: number;
  maxForce: number;
  overlapForceMax: number;
}

export interface PairForceComponents {
  attraction: number;
  repulsion: number;
}

export const ATTRACTION_FORCE_SCALE = 0.005;
export const REPULSION_FORCE_SCALE = 0.01;

export function computePairForceComponents(
  params: PairForceParams,
): PairForceComponents {
  const restDist = params.bodyRadius * 2;
  const maxDist = Math.max(
    restDist,
    params.interactionRange * params.bodyRadius,
  );

  if (params.dist >= maxDist) {
    return { attraction: 0, repulsion: 0 };
  }

  if (params.dist < restDist) {
    const overlap = (restDist - params.dist) / restDist;
    return {
      attraction: 0,
      repulsion: Math.min(
        params.stiffness * REPULSION_FORCE_SCALE * overlap,
        params.overlapForceMax,
      ),
    };
  }

  const span = Math.max(maxDist - restDist, 0.001);
  const t = Math.max(0, Math.min(1, (params.dist - restDist) / span));
  const pull = 4 * t * (1 - t);

  return {
    attraction: Math.min(
      params.stickiness * ATTRACTION_FORCE_SCALE * pull,
      params.maxForce,
    ),
    repulsion: 0,
  };
}

export const PAIR_FORCE_GLSL = `
vec2 computePairForceComponents(
  float dist,
  float bodyRadius,
  float interactionRange,
  float stickiness,
  float stiffness,
  float maxForce,
  float overlapForceMax
) {
  float restDist = bodyRadius * 2.0;
  float maxDist = max(restDist, interactionRange * bodyRadius);

  if (dist >= maxDist) {
    return vec2(0.0);
  }

  if (dist < restDist) {
    float overlap = (restDist - dist) / restDist;
    float repulsion = min(stiffness * ${REPULSION_FORCE_SCALE.toFixed(2)} * overlap, overlapForceMax);
    return vec2(0.0, repulsion);
  }

  float span = max(maxDist - restDist, 0.001);
  float t = clamp((dist - restDist) / span, 0.0, 1.0);
  float pull = 4.0 * t * (1.0 - t);
  float attraction = min(stickiness * ${ATTRACTION_FORCE_SCALE.toFixed(3)} * pull, maxForce);
  return vec2(attraction, 0.0);
}
`;
