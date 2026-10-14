export interface DocumentRecord {
  id: string; source_url: string; title: string; source_type: 'html' | 'pdf'; category: string;
  course_code: string | null; content_hash: string; fetched_at: string; searchable: boolean;
  review_status: string; metadata: Record<string, unknown>;
}
export interface ChunkRecord {
  id: string; document_id: string; chunk_index: number; content: string; content_hash: string;
  token_count: number; section: string; page_start: number | null; page_end: number | null;
  source_url: string; title: string; category: string; course_code: string | null;
  metadata: Record<string, unknown>;
}
export interface SearchHit extends ChunkRecord { score: number; semantic_similarity?: number }
