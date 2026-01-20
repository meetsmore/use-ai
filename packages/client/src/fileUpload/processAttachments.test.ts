import { describe, it, expect, beforeEach } from 'bun:test';
import { processAttachments, clearTransformationCache } from './processAttachments';
import type { FileAttachment, FileTransformer, FileProcessingState, FileUploadBackend } from './types';

// Mock backend that works in Node/Bun environment (no FileReader needed)
class MockFileUploadBackend implements FileUploadBackend {
  async prepareForSend(file: File): Promise<string> {
    // Return a mock data URL
    return `data:${file.type};base64,bW9ja2VkLWNvbnRlbnQ=`;
  }
}

// Helper to create a mock File
function createMockFile(name: string, type: string, content: string = 'test content'): File {
  const blob = new Blob([content], { type });
  return new File([blob], name, { type, lastModified: Date.now() });
}

// Helper to create a FileAttachment
function createAttachment(id: string, name: string, type: string): FileAttachment {
  return {
    id,
    file: createMockFile(name, type),
  };
}

const mockBackend = new MockFileUploadBackend();

describe('processAttachments', () => {
  beforeEach(() => {
    // Clear transformation cache before each test
    clearTransformationCache();
  });

  describe('without transformers', () => {
    it('processes images as image content', async () => {
      const attachment = createAttachment('1', 'photo.png', 'image/png');
      const result = await processAttachments([attachment], { backend: mockBackend });

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('image');
      expect((result[0] as { type: 'image'; url: string }).url).toContain('data:image/png;base64,');
    });

    it('processes non-images as file content', async () => {
      const attachment = createAttachment('1', 'document.pdf', 'application/pdf');
      const result = await processAttachments([attachment], { backend: mockBackend });

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('file');
      const fileContent = result[0] as { type: 'file'; url: string; mimeType: string; name: string };
      expect(fileContent.mimeType).toBe('application/pdf');
      expect(fileContent.name).toBe('document.pdf');
      expect(fileContent.url).toContain('data:application/pdf;base64,');
    });

    it('processes multiple attachments', async () => {
      const attachments = [
        createAttachment('1', 'photo.png', 'image/png'),
        createAttachment('2', 'doc.pdf', 'application/pdf'),
      ];

      const result = await processAttachments(attachments, { backend: mockBackend });

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('image');
      expect(result[1].type).toBe('file');
    });
  });

  describe('with transformers', () => {
    it('transforms files with matching transformer', async () => {
      const transformer: FileTransformer = {
        transform: async (file) => `Transformed: ${file.name}`,
      };

      const attachment = createAttachment('1', 'test.pdf', 'application/pdf');
      const result = await processAttachments([attachment], {
        transformers: { 'application/pdf': transformer },
      });

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('transformed_file');
      const transformed = result[0] as { type: 'transformed_file'; text: string; originalFile: { name: string } };
      expect(transformed.text).toBe('Transformed: test.pdf');
      expect(transformed.originalFile.name).toBe('test.pdf');
    });

    it('caches transformation results', async () => {
      let callCount = 0;
      const transformer: FileTransformer = {
        transform: async (file) => {
          callCount++;
          return `Transformed: ${file.name}`;
        },
      };

      const file = createMockFile('test.pdf', 'application/pdf');
      const attachment: FileAttachment = { id: '1', file };
      const config = { transformers: { 'application/pdf': transformer } };

      // First call
      await processAttachments([attachment], config);
      expect(callCount).toBe(1);

      // Second call with same file - should use cache
      await processAttachments([attachment], config);
      expect(callCount).toBe(1); // Still 1, not 2
    });

    it('does not cache different files', async () => {
      let callCount = 0;
      const transformer: FileTransformer = {
        transform: async (file) => {
          callCount++;
          return `Transformed: ${file.name}`;
        },
      };

      const config = { transformers: { 'application/pdf': transformer } };

      // First file
      await processAttachments([createAttachment('1', 'doc1.pdf', 'application/pdf')], config);
      expect(callCount).toBe(1);

      // Different file
      await processAttachments([createAttachment('2', 'doc2.pdf', 'application/pdf')], config);
      expect(callCount).toBe(2);
    });

    it('uses default handling for non-matching files', async () => {
      const transformer: FileTransformer = {
        transform: async () => 'transformed',
      };

      const attachment = createAttachment('1', 'photo.png', 'image/png');
      const result = await processAttachments([attachment], {
        backend: mockBackend,
        transformers: { 'application/pdf': transformer },
      });

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('image'); // Not transformed_file
    });

    it('matches wildcard patterns', async () => {
      const transformer: FileTransformer = {
        transform: async (file) => `Transformed: ${file.name}`,
      };

      const attachment = createAttachment('1', 'photo.png', 'image/png');
      const result = await processAttachments([attachment], {
        transformers: { 'image/*': transformer },
      });

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('transformed_file');
    });

    it('throws on transformer error', async () => {
      const transformer: FileTransformer = {
        transform: async () => {
          throw new Error('Transform failed');
        },
      };

      const attachment = createAttachment('1', 'test.pdf', 'application/pdf');

      await expect(
        processAttachments([attachment], {
          transformers: { 'application/pdf': transformer },
        })
      ).rejects.toThrow('Transform failed');
    });
  });

  describe('progress callbacks', () => {
    it('calls onFileProgress with status updates', async () => {
      const progressUpdates: Array<{ fileId: string; state: FileProcessingState }> = [];

      const attachment = createAttachment('1', 'photo.png', 'image/png');
      await processAttachments([attachment], {
        backend: mockBackend,
        onFileProgress: (fileId, state) => {
          progressUpdates.push({ fileId, state });
        },
      });

      expect(progressUpdates.length).toBeGreaterThanOrEqual(2);
      expect(progressUpdates[0]).toEqual({ fileId: '1', state: { status: 'processing' } });
      expect(progressUpdates[progressUpdates.length - 1]).toEqual({ fileId: '1', state: { status: 'done' } });
    });

    it('reports progress from transformer', async () => {
      const progressUpdates: Array<{ fileId: string; state: FileProcessingState }> = [];

      const transformer: FileTransformer = {
        transform: async (file, onProgress) => {
          onProgress?.(50);
          onProgress?.(100);
          return 'done';
        },
      };

      const attachment = createAttachment('1', 'test.pdf', 'application/pdf');
      await processAttachments([attachment], {
        transformers: { 'application/pdf': transformer },
        onFileProgress: (fileId, state) => {
          progressUpdates.push({ fileId, state });
        },
      });

      // Should have processing, progress updates, and done
      const processingWithProgress = progressUpdates.filter(
        (u) => u.state.status === 'processing' && u.state.progress !== undefined
      );
      expect(processingWithProgress.length).toBe(2);
      expect(processingWithProgress[0].state.progress).toBe(50);
      expect(processingWithProgress[1].state.progress).toBe(100);
    });

    it('reports error status on transformer failure', async () => {
      const progressUpdates: Array<{ fileId: string; state: FileProcessingState }> = [];

      const transformer: FileTransformer = {
        transform: async () => {
          throw new Error('Failed');
        },
      };

      const attachment = createAttachment('1', 'test.pdf', 'application/pdf');

      try {
        await processAttachments([attachment], {
          transformers: { 'application/pdf': transformer },
          onFileProgress: (fileId, state) => {
            progressUpdates.push({ fileId, state });
          },
        });
      } catch {
        // Expected to throw
      }

      const errorUpdate = progressUpdates.find((u) => u.state.status === 'error');
      expect(errorUpdate).toBeDefined();
    });
  });
});
