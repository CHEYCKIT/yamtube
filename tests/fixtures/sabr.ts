import { CompositeBuffer, UmpWriter } from 'googlevideo/ump'
import { MediaHeader, UMPPartId } from 'googlevideo/protos'
import { concatenateChunks, type RequestMetadataManager } from 'googlevideo/utils'

export function umpPart(type: number, data: Uint8Array): Uint8Array {
  const buffer = new CompositeBuffer()
  new UmpWriter(buffer).write(type, data)
  return concatenateChunks(buffer.chunks)
}

export function mediaSegment(sequence: number, startMs: number, data = new Uint8Array([sequence, sequence, sequence]), itag = 137): Uint8Array {
  return concatenateChunks([
    umpPart(UMPPartId.MEDIA_HEADER, MediaHeader.encode({ headerId: sequence, itag, sequenceNumber: sequence,
      startMs: String(startMs), durationMs: '5000', isInitSeg: false, contentLength: String(data.byteLength) }).finish()),
    umpPart(UMPPartId.MEDIA, new Uint8Array([sequence, ...data])),
    umpPart(UMPPartId.MEDIA_END, new Uint8Array([sequence]))
  ])
}

export function sabrMetadata(): NonNullable<ReturnType<RequestMetadataManager['getRequestMetadata']>> {
  return { isSABR: true, isInit: false, format: { itag: 137, lastModified: '1', approxDurationMs: 30000, xtags: '', mimeType: 'video/mp4', bitrate: 1000000 }, timestamp: Date.now() }
}
