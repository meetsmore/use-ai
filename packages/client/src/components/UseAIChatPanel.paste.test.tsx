import React from 'react';
import { describe, test, expect, mock } from 'bun:test';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { UseAIChatPanel } from './UseAIChatPanel';
import type { FileUploadConfig } from '../fileUpload/types';

// Images take the FileReader path for preview generation, which the test
// environment does not provide, so these use PDFs. Pasting an image is covered
// by the e2e test in apps/example.
const config: FileUploadConfig = {
  acceptedTypes: ['image/*', 'application/pdf'],
};

function renderPanel({ fileUpload = true }: { fileUpload?: boolean } = {}) {
  return render(
    <UseAIChatPanel
      onSendMessage={mock(() => {})}
      messages={[]}
      loading={false}
      connected
      fileUploadConfig={fileUpload ? config : undefined}
    />
  );
}

/** A clipboard carrying `files`, and whatever `types` the source advertised. */
function clipboard(types: string[], files: File[]) {
  return {
    clipboardData: {
      files,
      types,
      getData: () => '',
    },
  };
}

const pdf = () => new File(['%PDF-1.4'], 'report.pdf', { type: 'application/pdf' });

describe('pasting files into the built-in composer', () => {
  test('attaches the pasted file', async () => {
    const { getByTestId } = renderPanel();

    fireEvent.paste(getByTestId('chat-input'), clipboard(['Files'], [pdf()]));

    await waitFor(() => expect(getByTestId('file-chip')).toHaveTextContent('report.pdf'));
  });

  test('takes the paste over when the clipboard carries no text', async () => {
    const { getByTestId } = renderPanel();

    const notPrevented = fireEvent.paste(getByTestId('chat-input'), clipboard(['Files'], [pdf()]));

    expect(notPrevented).toBe(false);
    await waitFor(() => expect(getByTestId('file-chip')).toBeInTheDocument());
  });

  test('leaves the text insertion alone when the clipboard also carries text', async () => {
    const { getByTestId } = renderPanel();

    const notPrevented = fireEvent.paste(
      getByTestId('chat-input'),
      clipboard(['text/plain', 'text/html', 'Files'], [pdf()])
    );

    // The browser still inserts the text; the file is attached alongside it.
    expect(notPrevented).toBe(true);
    await waitFor(() => expect(getByTestId('file-chip')).toBeInTheDocument());
  });

  test('ignores a paste that carries no file', () => {
    const { getByTestId, queryByTestId } = renderPanel();

    const notPrevented = fireEvent.paste(getByTestId('chat-input'), clipboard(['text/plain'], []));

    expect(notPrevented).toBe(true);
    expect(queryByTestId('file-chip')).toBeNull();
  });

  test('reports why a file was rejected instead of doing nothing', async () => {
    const { getByTestId, queryByTestId } = renderPanel();

    const zip = new File(['zip'], 'archive.zip', { type: 'application/zip' });
    fireEvent.paste(getByTestId('chat-input'), clipboard(['Files'], [zip]));

    await waitFor(() => expect(getByTestId('file-error')).toHaveTextContent('application/zip'));
    expect(queryByTestId('file-chip')).toBeNull();
  });

  test('labels a file the browser gave no name', async () => {
    const { getByTestId } = renderPanel();

    const unnamed = new File(['%PDF-1.4'], '', { type: 'application/pdf' });
    fireEvent.paste(getByTestId('chat-input'), clipboard(['Files'], [unnamed]));

    await waitFor(() => expect(getByTestId('file-chip')).toHaveTextContent('pasted-file.pdf'));
  });

  test('does nothing when file upload is not configured', () => {
    const { getByTestId, queryByTestId } = renderPanel({ fileUpload: false });

    const notPrevented = fireEvent.paste(getByTestId('chat-input'), clipboard(['Files'], [pdf()]));

    expect(notPrevented).toBe(true);
    expect(queryByTestId('file-chip')).toBeNull();
  });
});

