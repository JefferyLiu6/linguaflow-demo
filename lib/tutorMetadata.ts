export interface RetrievedSource {
  id: string
  title: string
}

function hasRetrievalHit(meta: Record<string, unknown>) {
  return meta.retrieval_hit === true || meta.retrievalHit === true
}

function getRetrievedSources(meta: Record<string, unknown>) {
  const sources = meta.retrieved_sources ?? meta.retrievedSources
  return Array.isArray(sources) ? sources : []
}

export function getCoachReferenceTitle(meta: Record<string, unknown>): string | null {
  if (!hasRetrievalHit(meta)) {
    return null
  }

  const firstSource = getRetrievedSources(meta)[0]
  if (!firstSource || typeof firstSource !== 'object') {
    return null
  }

  const title = (firstSource as RetrievedSource).title
  return typeof title === 'string' && title.trim() ? title : null
}
