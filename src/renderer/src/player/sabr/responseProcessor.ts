import { SabrUmpProcessor, type UmpProcessingResult } from 'googlevideo/sabr-streaming-adapter'
import { CompositeBuffer, UmpReader } from 'googlevideo/ump'
import { concatenateChunks } from 'googlevideo/utils'

/**
 * HTTP chunks are arbitrary: they may split a UMP header or contain several
 * complete segments. Feed the upstream processor one complete part at a time.
 * Its processChunk otherwise keeps parsing after resolving the first MediaEnd,
 * returning that segment's bytes with a later segment's metadata. The adapter
 * then tells YouTube that the later segment is buffered, leaving a real hole.
 */
export class SabrResponseProcessor {
  private readonly processor: SabrUmpProcessor
  private pending = new CompositeBuffer()
  private result: UmpProcessingResult | undefined

  constructor(...parameters: ConstructorParameters<typeof SabrUmpProcessor>) {
    this.processor = new SabrUmpProcessor(...parameters)
  }

  async processChunk(chunk: Uint8Array): Promise<UmpProcessingResult | undefined> {
    if (this.result) return this.result
    if (chunk.length) this.pending.append(chunk)
    while (this.pending.getLength()) {
      const reader = new UmpReader(this.pending)
      const [type, typeEnd] = reader.readVarInt(0)
      if (type < 0) return undefined
      const [length, headerEnd] = reader.readVarInt(typeEnd)
      if (length < 0) return undefined
      if (length > 64 * 1024 * 1024) throw new Error('Invalid SABR media part length')
      const frameEnd = headerEnd + length
      if (!this.pending.canReadBytes(0, frameEnd)) return undefined
      const { extractedBuffer, remainingBuffer } = this.pending.split(frameEnd)
      this.pending = remainingBuffer
      const result = await this.processor.processChunk(concatenateChunks(extractedBuffer.chunks))
      if (result) {
        this.result = result
        this.pending = new CompositeBuffer()
        return result
      }
    }
    return undefined
  }

  assertComplete(): void {
    // Complete control-only responses (e.g. redirects) still go through the
    // response interceptor. A partial frame or media segment must be retried.
    if (!this.result && (this.pending.getLength() || this.processor.getSegmentInfo())) {
      throw new Error('SABR response ended before its media segment completed')
    }
  }
}
