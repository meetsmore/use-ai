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

// Default getCurrentChat for tests (no chat needed for unit tests)
const testGetCurrentChat = async () => null;

describe('processAttachments', () => {
  beforeEach(() => {
    // Clear transformation cache before each test
    clearTransformationCache();
  });

  describe('without transformers', () => {
    it('processes images as image content', async () => {
      const attachment = createAttachment('1', 'photo.png', 'image/png');
      const result = await processAttachments([attachment], { getCurrentChat: testGetCurrentChat, backend: mockBackend });

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('image');
      expect((result[0] as { type: 'image'; url: string }).url).toContain('data:image/png;base64,');
    });

    it('processes non-images as file content', async () => {
      const attachment = createAttachment('1', 'document.pdf', 'application/pdf');
      const result = await processAttachments([attachment], { getCurrentChat: testGetCurrentChat, backend: mockBackend });

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

      const result = await processAttachments(attachments, { getCurrentChat: testGetCurrentChat, backend: mockBackend });

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('image');
      expect(result[1].type).toBe('file');
    });
  });

  describe('with a ref-returning backend', () => {
    // Backend that uploads to storage and returns a persistent ref.
    const refBackend: FileUploadBackend = {
      async prepareForSend(file: File) {
        return { ref: `tenant/ai/user/${file.name}` };
      },
    };

    it('emits a ref-bearing image part (no url)', async () => {
      const attachment = createAttachment('1', 'photo.png', 'image/png');
      const [part] = await processAttachments([attachment], { getCurrentChat: testGetCurrentChat, backend: refBackend });
      expect(part).toEqual({ type: 'image', ref: 'tenant/ai/user/photo.png' });
      expect((part as { url?: string }).url).toBeUndefined();
    });

    it('emits a ref-bearing file part with mimeType and name', async () => {
      const attachment = createAttachment('1', 'doc.pdf', 'application/pdf');
      const [part] = await processAttachments([attachment], { getCurrentChat: testGetCurrentChat, backend: refBackend });
      expect(part).toEqual({
        type: 'file',
        ref: 'tenant/ai/user/doc.pdf',
        mimeType: 'application/pdf',
        name: 'doc.pdf',
      });
    });

    it('treats a bare string return as a url (backward compatibility)', async () => {
      const stringBackend: FileUploadBackend = {
        async prepareForSend() {
          return 'data:image/png;base64,AAAA';
        },
      };
      const attachment = createAttachment('1', 'photo.png', 'image/png');
      const [part] = await processAttachments([attachment], { getCurrentChat: testGetCurrentChat, backend: stringBackend });
      expect(part).toEqual({ type: 'image', url: 'data:image/png;base64,AAAA' });
    });
  });

  describe('with pre-transformed content', () => {
    it('uses pre-transformed content when available', async () => {
      const attachment: FileAttachment = {
        id: '1',
        file: createMockFile('doc.pdf', 'application/pdf'),
        transformedContent: 'Pre-transformed PDF content',
      };

      const result = await processAttachments([attachment], { getCurrentChat: testGetCurrentChat, backend: mockBackend });

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('transformed_file');
      const transformed = result[0] as { type: 'transformed_file'; text: string; originalFile: { name: string } };
      expect(transformed.text).toBe('Pre-transformed PDF content');
      expect(transformed.originalFile.name).toBe('doc.pdf');
    });

    it('skips transformer lookup when pre-transformed content exists', async () => {
      let transformerCalled = false;
      const transformer: FileTransformer = {
        transform: async (files, _context) => {
          transformerCalled = true;
          return files.map((f) => `From transformer: ${f.name}`);
        },
      };

      const attachment: FileAttachment = {
        id: '1',
        file: createMockFile('doc.pdf', 'application/pdf'),
        transformedContent: 'Pre-transformed content',
      };

      const result = await processAttachments([attachment], {
        getCurrentChat: testGetCurrentChat,
        backend: mockBackend,
        transformers: { 'application/pdf': transformer },
      });

      expect(transformerCalled).toBe(false);
      expect(result[0].type).toBe('transformed_file');
      expect((result[0] as { text: string }).text).toBe('Pre-transformed content');
    });
  });

  describe('with transformers', () => {
    it('transforms files with matching transformer', async () => {
      const transformer: FileTransformer = {
        transform: async (files, _context) => files.map((f) => `Transformed: ${f.name}`),
      };

      const attachment = createAttachment('1', 'test.pdf', 'application/pdf');
      const result = await processAttachments([attachment], {
        getCurrentChat: testGetCurrentChat,
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
        transform: async (files, _context) => {
          callCount++;
          return files.map((f) => `Transformed: ${f.name}`);
        },
      };

      const file = createMockFile('test.pdf', 'application/pdf');
      const attachment: FileAttachment = { id: '1', file };
      const config = { getCurrentChat: testGetCurrentChat, transformers: { 'application/pdf': transformer } };

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
        transform: async (files, _context) => {
          callCount++;
          return files.map((f) => `Transformed: ${f.name}`);
        },
      };

      const config = { getCurrentChat: testGetCurrentChat, transformers: { 'application/pdf': transformer } };

      // First file
      await processAttachments([createAttachment('1', 'doc1.pdf', 'application/pdf')], config);
      expect(callCount).toBe(1);

      // Different file
      await processAttachments([createAttachment('2', 'doc2.pdf', 'application/pdf')], config);
      expect(callCount).toBe(2);
    });

    it('uses default handling for non-matching files', async () => {
      const transformer: FileTransformer = {
        transform: async (files, _context) => files.map(() => 'transformed'),
      };

      const attachment = createAttachment('1', 'photo.png', 'image/png');
      const result = await processAttachments([attachment], {
        getCurrentChat: testGetCurrentChat,
        backend: mockBackend,
        transformers: { 'application/pdf': transformer },
      });

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('image'); // Not transformed_file
    });

    it('matches wildcard patterns', async () => {
      const transformer: FileTransformer = {
        transform: async (files, _context) => files.map((f) => `Transformed: ${f.name}`),
      };

      const attachment = createAttachment('1', 'photo.png', 'image/png');
      const result = await processAttachments([attachment], {
        getCurrentChat: testGetCurrentChat,
        transformers: { 'image/*': transformer },
      });

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('transformed_file');
    });

    it('throws on transformer error', async () => {
      const transformer: FileTransformer = {
        transform: async (_files, _context) => {
          throw new Error('Transform failed');
        },
      };

      const attachment = createAttachment('1', 'test.pdf', 'application/pdf');

      await expect(
        processAttachments([attachment], {
          getCurrentChat: testGetCurrentChat,
          transformers: { 'application/pdf': transformer },
        })
      ).rejects.toThrow('Transform failed');
    });

    it('passes chat context to transformer', async () => {
      const mockChat = {
        id: 'test-chat-id',
        title: 'Test Chat',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: { customField: 'customValue', documentType: 'invoice' },
      };

      let receivedContext: unknown = null;
      const transformer: FileTransformer = {
        transform: async (files, context) => {
          receivedContext = context;
          return files.map(() => 'Transformed with context');
        },
      };

      const attachment = createAttachment('1', 'test.pdf', 'application/pdf');
      await processAttachments([attachment], {
        getCurrentChat: async () => mockChat,
        transformers: { 'application/pdf': transformer },
      });

      expect(receivedContext).not.toBeNull();
      expect((receivedContext as { chat: typeof mockChat }).chat).toBe(mockChat);
      expect((receivedContext as { chat: typeof mockChat }).chat.metadata).toEqual({
        customField: 'customValue',
        documentType: 'invoice',
      });
    });

    it('passes null chat context when no chat exists', async () => {
      let receivedContext: unknown = null;
      const transformer: FileTransformer = {
        transform: async (files, context) => {
          receivedContext = context;
          return files.map(() => 'Transformed');
        },
      };

      const attachment = createAttachment('1', 'test.pdf', 'application/pdf');
      await processAttachments([attachment], {
        getCurrentChat: async () => null,
        transformers: { 'application/pdf': transformer },
      });

      expect(receivedContext).not.toBeNull();
      expect((receivedContext as { chat: null }).chat).toBeNull();
    });
  });

  describe('progress callbacks', () => {
    it('calls onFileProgress with status updates when transformer runs', async () => {
      const progressUpdates: Array<{ fileId: string; state: FileProcessingState }> = [];

      const transformer: FileTransformer = {
        transform: async (files, _context) => files.map((f) => `Transformed: ${f.name}`),
      };

      const attachment = createAttachment('1', 'test.pdf', 'application/pdf');
      await processAttachments([attachment], {
        getCurrentChat: testGetCurrentChat,
        transformers: { 'application/pdf': transformer },
        onFileProgress: (fileId, state) => {
          progressUpdates.push({ fileId, state });
        },
      });

      expect(progressUpdates.length).toBeGreaterThanOrEqual(2);
      expect(progressUpdates[0]).toEqual({ fileId: '1', state: { status: 'processing' } });
      expect(progressUpdates[progressUpdates.length - 1]).toEqual({ fileId: '1', state: { status: 'done' } });
    });

    it('does not call onFileProgress when no transformer matches', async () => {
      const progressUpdates: Array<{ fileId: string; state: FileProcessingState }> = [];

      // Image file with no transformer configured
      const attachment = createAttachment('1', 'photo.png', 'image/png');
      await processAttachments([attachment], {
        getCurrentChat: testGetCurrentChat,
        backend: mockBackend,
        onFileProgress: (fileId, state) => {
          progressUpdates.push({ fileId, state });
        },
      });

      // No transformer matched, so onFileProgress should not be called
      expect(progressUpdates).toHaveLength(0);
    });

    it('reports progress from transformer', async () => {
      const progressUpdates: Array<{ fileId: string; state: FileProcessingState }> = [];

      const transformer: FileTransformer = {
        transform: async (files, _context, onProgress) => {
          onProgress?.(50);
          onProgress?.(100);
          return files.map(() => 'done');
        },
      };

      const attachment = createAttachment('1', 'test.pdf', 'application/pdf');
      await processAttachments([attachment], {
        getCurrentChat: testGetCurrentChat,
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
        transform: async (_files, _context) => {
          throw new Error('Failed');
        },
      };

      const attachment = createAttachment('1', 'test.pdf', 'application/pdf');

      try {
        await processAttachments([attachment], {
          getCurrentChat: testGetCurrentChat,
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

  describe('with multiple files matching one transformer', () => {
    it('passes all matching files to transformer at once', async () => {
      let receivedFiles: string[] = [];

      const transformer: FileTransformer = {
        transform: async (files, _context) => {
          receivedFiles = files.map((f) => f.name);
          return files.map((f) => `Result: ${f.name}`);
        },
      };

      const attachments = [
        createAttachment('1', 'doc1.pdf', 'application/pdf'),
        createAttachment('2', 'doc2.pdf', 'application/pdf'),
        createAttachment('3', 'doc3.pdf', 'application/pdf'),
      ];

      const result = await processAttachments(attachments, {
        getCurrentChat: testGetCurrentChat,
        transformers: { 'application/pdf': transformer },
      });

      // All files should be passed to a single transform call
      expect(receivedFiles).toEqual(['doc1.pdf', 'doc2.pdf', 'doc3.pdf']);
      expect(result).toHaveLength(3);
      expect((result[0] as { text: string }).text).toBe('Result: doc1.pdf');
      expect((result[1] as { text: string }).text).toBe('Result: doc2.pdf');
      expect((result[2] as { text: string }).text).toBe('Result: doc3.pdf');
    });

    it('caches results per group', async () => {
      let callCount = 0;

      const transformer: FileTransformer = {
        transform: async (files, _context) => {
          callCount++;
          return files.map((f) => `Result: ${f.name}`);
        },
      };

      const file1 = createMockFile('doc1.pdf', 'application/pdf');
      const file2 = createMockFile('doc2.pdf', 'application/pdf');
      const attachments: FileAttachment[] = [
        { id: '1', file: file1 },
        { id: '2', file: file2 },
      ];

      const config = {
        getCurrentChat: testGetCurrentChat,
        transformers: { 'application/pdf': transformer },
      };

      // First call
      await processAttachments(attachments, config);
      expect(callCount).toBe(1);

      // Second call with same files - should use cache
      await processAttachments(attachments, config);
      expect(callCount).toBe(1); // Still 1, not 2
    });

    it('groups files by transformer', async () => {
      let pdfFiles: string[] = [];
      let imageFiles: string[] = [];

      const pdfTransformer: FileTransformer = {
        transform: async (files, _context) => {
          pdfFiles = files.map((f) => f.name);
          return files.map((f) => `PDF: ${f.name}`);
        },
      };

      const imageTransformer: FileTransformer = {
        transform: async (files, _context) => {
          imageFiles = files.map((f) => f.name);
          return files.map((f) => `Image: ${f.name}`);
        },
      };

      const attachments = [
        createAttachment('1', 'doc1.pdf', 'application/pdf'),
        createAttachment('2', 'img1.png', 'image/png'),
        createAttachment('3', 'doc2.pdf', 'application/pdf'),
        createAttachment('4', 'img2.png', 'image/png'),
      ];

      await processAttachments(attachments, {
        getCurrentChat: testGetCurrentChat,
        transformers: {
          'application/pdf': pdfTransformer,
          'image/png': imageTransformer,
        },
      });

      expect(pdfFiles).toEqual(['doc1.pdf', 'doc2.pdf']);
      expect(imageFiles).toEqual(['img1.png', 'img2.png']);
    });

    it('reports progress for all files in the group', async () => {
      const progressUpdates: Array<{ fileId: string; state: FileProcessingState }> = [];

      const transformer: FileTransformer = {
        transform: async (files, _context, onProgress) => {
          onProgress?.(50);
          onProgress?.(100);
          return files.map((f) => `Result: ${f.name}`);
        },
      };

      const attachments = [
        createAttachment('1', 'doc1.pdf', 'application/pdf'),
        createAttachment('2', 'doc2.pdf', 'application/pdf'),
      ];

      await processAttachments(attachments, {
        getCurrentChat: testGetCurrentChat,
        transformers: { 'application/pdf': transformer },
        onFileProgress: (fileId, state) => {
          progressUpdates.push({ fileId, state });
        },
      });

      // Both files should receive progress updates
      const file1Updates = progressUpdates.filter((u) => u.fileId === '1');
      const file2Updates = progressUpdates.filter((u) => u.fileId === '2');

      expect(file1Updates.length).toBeGreaterThanOrEqual(2);
      expect(file2Updates.length).toBeGreaterThanOrEqual(2);

      // Both should end with done
      expect(file1Updates[file1Updates.length - 1].state.status).toBe('done');
      expect(file2Updates[file2Updates.length - 1].state.status).toBe('done');
    });

    it('marks all files as error on failure', async () => {
      const progressUpdates: Array<{ fileId: string; state: FileProcessingState }> = [];

      const transformer: FileTransformer = {
        transform: async (_files, _context) => {
          throw new Error('Transform failed');
        },
      };

      const attachments = [
        createAttachment('1', 'doc1.pdf', 'application/pdf'),
        createAttachment('2', 'doc2.pdf', 'application/pdf'),
      ];

      try {
        await processAttachments(attachments, {
          getCurrentChat: testGetCurrentChat,
          transformers: { 'application/pdf': transformer },
          onFileProgress: (fileId, state) => {
            progressUpdates.push({ fileId, state });
          },
        });
      } catch {
        // Expected to throw
      }

      // All files should be marked as error
      const errorUpdates = progressUpdates.filter((u) => u.state.status === 'error');
      expect(errorUpdates).toHaveLength(2);
    });

    it('passes context to transformer', async () => {
      const mockChat = {
        id: 'test-chat',
        title: 'Test',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: { targetType: 'ocr' },
      };

      let receivedContext: unknown = null;

      const transformer: FileTransformer = {
        transform: async (files, context) => {
          receivedContext = context;
          return files.map((f) => `Result: ${f.name}`);
        },
      };

      const attachments = [
        createAttachment('1', 'doc1.pdf', 'application/pdf'),
        createAttachment('2', 'doc2.pdf', 'application/pdf'),
      ];

      await processAttachments(attachments, {
        getCurrentChat: async () => mockChat,
        transformers: { 'application/pdf': transformer },
      });

      expect((receivedContext as { chat: typeof mockChat }).chat).toBe(mockChat);
      expect((receivedContext as { chat: typeof mockChat }).chat.metadata).toEqual({ targetType: 'ocr' });
    });

    it('handles empty attachments array', async () => {
      const result = await processAttachments([], {
        getCurrentChat: testGetCurrentChat,
        backend: mockBackend,
      });

      expect(result).toHaveLength(0);
    });

    it('caches by group composition — different group is a cache miss', async () => {
      const transformCalls: string[][] = [];
      const transformer: FileTransformer = {
        transform: async (files, _context) => {
          transformCalls.push(files.map((f) => f.name));
          return files.map((f) => `Result: ${f.name}`);
        },
      };

      const file1 = createMockFile('doc1.pdf', 'application/pdf');
      const file2 = createMockFile('doc2.pdf', 'application/pdf');
      const file3 = createMockFile('doc3.pdf', 'application/pdf');

      const config = {
        getCurrentChat: testGetCurrentChat,
        transformers: { 'application/pdf': transformer },
      };

      // First call: [file1, file2]
      await processAttachments(
        [{ id: '1', file: file1 }, { id: '2', file: file2 }],
        config
      );
      expect(transformCalls).toHaveLength(1);

      // Second call: different group [file1, file2, file3] → cache miss
      await processAttachments(
        [{ id: '1', file: file1 }, { id: '2', file: file2 }, { id: '3', file: file3 }],
        config
      );
      expect(transformCalls).toHaveLength(2);
      expect(transformCalls[1]).toEqual(['doc1.pdf', 'doc2.pdf', 'doc3.pdf']);
    });

    it('groups by pattern key, not transformer instance', async () => {
      const calls: string[][] = [];

      const sharedTransformer: FileTransformer = {
        transform: async (files, _context) => {
          calls.push(files.map((f) => f.name));
          return files.map((f) => `Result: ${f.name}`);
        },
      };

      const attachments = [
        createAttachment('1', 'photo.jpg', 'image/jpeg'),
        createAttachment('2', 'scan.png', 'image/png'),
      ];

      await processAttachments(attachments, {
        getCurrentChat: testGetCurrentChat,
        transformers: {
          'image/jpeg': sharedTransformer,
          'image/png': sharedTransformer,
        },
      });

      // Different keys → separate transform calls, even with same instance
      expect(calls).toHaveLength(2);
      expect(calls[0]).toEqual(['photo.jpg']);
      expect(calls[1]).toEqual(['scan.png']);
    });

    it('groups files under same wildcard key', async () => {
      let receivedFiles: string[] = [];

      const imageTransformer: FileTransformer = {
        transform: async (files, _context) => {
          receivedFiles = files.map((f) => f.name);
          return files.map((f) => `Result: ${f.name}`);
        },
      };

      const attachments = [
        createAttachment('1', 'photo.jpg', 'image/jpeg'),
        createAttachment('2', 'scan.png', 'image/png'),
      ];

      await processAttachments(attachments, {
        getCurrentChat: testGetCurrentChat,
        transformers: {
          'image/*': imageTransformer,
        },
      });

      // Same key 'image/*' → grouped into a single transform call
      expect(receivedFiles).toEqual(['photo.jpg', 'scan.png']);
    });
  });
});
