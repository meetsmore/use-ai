export {
  DEFAULT_MAX_FILE_SIZE,
  type PersistedFileMetadata,
  type FileAttachment,
  type FileUploadBackend,
  type FileUploadConfig,
  type FileTransformer,
  type FileTransformerMap,
  type FileProcessingStatus,
  type FileProcessingState,
} from './types';

export { EmbedFileUploadBackend } from './EmbedFileUploadBackend';

export { matchesMimeType, findTransformer } from './mimeTypeMatcher';

export { processAttachments, clearTransformationCache, getTransformedContent, type ProcessAttachmentsConfig } from './processAttachments';
