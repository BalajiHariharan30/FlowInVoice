export class EmbeddingService {
  private static readonly VECTOR_DIMENSION = 384;

  /**
   * Generates embeddings vector. When no live provider is enabled,
   * generates deterministic normalized vector representation.
   */
  static async getEmbedding(text: string): Promise<number[]> {
    const vector = new Array(this.VECTOR_DIMENSION).fill(0);
    const cleaned = text.toLowerCase();

    for (let i = 0; i < cleaned.length; i++) {
      const charCode = cleaned.charCodeAt(i);
      const index = (charCode * 31 + i * 17) % this.VECTOR_DIMENSION;
      vector[index] += 1 / (1 + (i % 10));
    }

    // Normalize vector
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0)) || 1;
    return vector.map((v) => Number((v / norm).toFixed(6)));
  }
}
