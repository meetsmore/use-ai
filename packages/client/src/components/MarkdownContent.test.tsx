import { describe, it, expect } from 'bun:test';
import { render } from '@testing-library/react';
import { MarkdownContent } from './MarkdownContent';
import type { Citation } from '../types';
import { createCitationMarker } from '../types';

// Helper to create citation markers in tests
const c = createCitationMarker;

describe('MarkdownContent', () => {
  describe('basic markdown rendering', () => {
    it('should render plain text', () => {
      const { container } = render(<MarkdownContent content="Hello world" />);
      expect(container.textContent).toContain('Hello world');
    });

    it('should render markdown headings', () => {
      const { container } = render(<MarkdownContent content="# Heading 1" />);
      const h1 = container.querySelector('h1');
      expect(h1).not.toBeNull();
      expect(h1?.textContent).toBe('Heading 1');
    });

    it('should render markdown lists', () => {
      const content = `- Item 1
- Item 2`;
      const { container } = render(<MarkdownContent content={content} />);
      const ul = container.querySelector('ul');
      expect(ul).not.toBeNull();
      const listItems = container.querySelectorAll('li');
      expect(listItems).toHaveLength(2);
    });

    it('should render markdown links', () => {
      const { container } = render(<MarkdownContent content="[Link](https://example.com)" />);
      const link = container.querySelector('a');
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', 'https://example.com');
      expect(link).toHaveAttribute('target', '_blank');
    });

    it('should render inline code', () => {
      const { container } = render(<MarkdownContent content="Use `console.log()`" />);
      const code = container.querySelector('code');
      expect(code).toBeInTheDocument();
      expect(code?.textContent).toBe('console.log()');
    });
  });

  describe('citation chiclets', () => {
    const sampleCitations: Citation[] = [
      {
        id: 'cite-1',
        number: 1,
        type: 'url',
        url: 'https://example.com/research',
        title: 'Research Paper',
      },
      {
        id: 'cite-2',
        number: 2,
        type: 'url',
        url: 'https://www.example.org/study',
        title: 'Study Results',
      },
    ];

    it('should strip citation markers from text and show chiclet at paragraph end', () => {
      const { container } = render(
        <MarkdownContent content={`According to research${c(1)}.`} citations={sampleCitations} />
      );

      // The citation marker should be stripped from text
      const paragraph = container.querySelector('p');
      expect(paragraph?.textContent).toContain('According to research');
      expect(paragraph?.textContent).not.toContain(c(1));

      // Chiclet should be rendered
      const chicletLink = paragraph?.querySelector('a');
      expect(chicletLink).toBeInTheDocument();
      expect(chicletLink).toHaveAttribute('href', 'https://example.com/research');
    });

    it('should show multiple chiclets for multiple citations in same paragraph', () => {
      const { container } = render(
        <MarkdownContent content={`See${c(1)} and${c(2)} for details.`} citations={sampleCitations} />
      );

      const paragraph = container.querySelector('p');
      // Markers should be stripped
      expect(paragraph?.textContent).not.toContain(c(1));
      expect(paragraph?.textContent).not.toContain(c(2));

      // Both chiclets should be rendered
      const chicletLinks = paragraph?.querySelectorAll('span > a');
      expect(chicletLinks).toHaveLength(2);
      expect(chicletLinks?.[0]).toHaveAttribute('href', 'https://example.com/research');
      expect(chicletLinks?.[1]).toHaveAttribute('href', 'https://www.example.org/study');
    });

    it('should show chiclets only in paragraphs that contain markers', () => {
      const content = `First paragraph has citation${c(1)}.

Second paragraph has no citation.

Third paragraph has citation${c(2)}.`;
      const { container } = render(
        <MarkdownContent content={content} citations={sampleCitations} />
      );

      const paragraphs = container.querySelectorAll('p');
      expect(paragraphs).toHaveLength(3);

      // First paragraph should have citation 1
      const firstChiclets = paragraphs[0].querySelectorAll('span > a');
      expect(firstChiclets).toHaveLength(1);
      expect(firstChiclets[0]).toHaveAttribute('href', 'https://example.com/research');

      // Second paragraph should have no chiclets
      const secondChiclets = paragraphs[1].querySelectorAll('span > a');
      expect(secondChiclets).toHaveLength(0);

      // Third paragraph should have citation 2
      const thirdChiclets = paragraphs[2].querySelectorAll('span > a');
      expect(thirdChiclets).toHaveLength(1);
      expect(thirdChiclets[0]).toHaveAttribute('href', 'https://www.example.org/study');
    });

    it('should display domain name in chiclet', () => {
      const { container } = render(
        <MarkdownContent content={`Source${c(1)}`} citations={sampleCitations} />
      );

      const chicletLink = container.querySelector('span > a');
      expect(chicletLink?.textContent).toBe('example.com');
    });

    it('should strip www. from domain', () => {
      const { container } = render(
        <MarkdownContent content={`Source${c(2)}`} citations={sampleCitations} />
      );

      const chicletLink = container.querySelector('span > a');
      expect(chicletLink?.textContent).toBe('example.org');
    });

    it('should open chiclet links in new tab', () => {
      const { container } = render(
        <MarkdownContent content={`Source${c(1)}`} citations={sampleCitations} />
      );

      const chicletLink = container.querySelector('span > a');
      expect(chicletLink).toHaveAttribute('target', '_blank');
      expect(chicletLink).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('should set title attribute from citation title', () => {
      const { container } = render(
        <MarkdownContent content={`Source${c(1)}`} citations={sampleCitations} />
      );

      const chicletLink = container.querySelector('span > a');
      expect(chicletLink).toHaveAttribute('title', 'Research Paper');
    });

    it('should use URL as title when citation has no title', () => {
      const citationsNoTitle: Citation[] = [
        {
          id: 'cite-1',
          number: 1,
          type: 'url',
          url: 'https://example.com/no-title',
        },
      ];

      const { container } = render(
        <MarkdownContent content={`Source${c(1)}`} citations={citationsNoTitle} />
      );

      const chicletLink = container.querySelector('span > a');
      expect(chicletLink).toHaveAttribute('title', 'https://example.com/no-title');
    });

    it('should not show chiclet when citation number does not match', () => {
      const { container } = render(
        <MarkdownContent content={`Missing citation${c(99)}.`} citations={sampleCitations} />
      );

      // Marker should still be stripped
      expect(container.textContent).not.toContain(c(99));

      // But no chiclet since there's no citation with number 99
      const chicletLinks = container.querySelectorAll('span > a');
      expect(chicletLinks).toHaveLength(0);
    });

    it('should not show chiclet when citation lacks URL', () => {
      const citationsNoUrl: Citation[] = [
        {
          id: 'cite-1',
          number: 1,
          type: 'url',
          title: 'No URL Citation',
        },
      ];

      const { container } = render(
        <MarkdownContent content={`Source${c(1)}`} citations={citationsNoUrl} />
      );

      const chicletLinks = container.querySelectorAll('span > a');
      expect(chicletLinks).toHaveLength(0);
    });

    it('should strip markers but not show chiclets when citations array is empty', () => {
      const { container } = render(
        <MarkdownContent content={`No citations${c(1)}.`} citations={[]} />
      );

      // Markers should always be stripped, even without citation data
      expect(container.textContent).not.toContain(c(1));
      expect(container.textContent).toContain('No citations.');
      // No chiclets since there's no citation data
      const chicletLinks = container.querySelectorAll('span > a');
      expect(chicletLinks).toHaveLength(0);
    });

    it('should strip markers but not show chiclets when citations prop is omitted', () => {
      const { container } = render(
        <MarkdownContent content={`No citations${c(1)}.`} />
      );

      // Markers should always be stripped
      expect(container.textContent).not.toContain(c(1));
      expect(container.textContent).toContain('No citations.');
    });

    it('should render chiclets in list items', () => {
      const content = `- Finding one${c(1)}
- Finding two${c(2)}`;
      const { container } = render(
        <MarkdownContent content={content} citations={sampleCitations} />
      );

      const listItems = container.querySelectorAll('li');
      expect(listItems).toHaveLength(2);

      // Each list item should have its own chiclet
      const firstChiclet = listItems[0].querySelector('span > a');
      expect(firstChiclet).toHaveAttribute('href', 'https://example.com/research');

      const secondChiclet = listItems[1].querySelector('span > a');
      expect(secondChiclet).toHaveAttribute('href', 'https://www.example.org/study');
    });

    it('should render chiclets in headings', () => {
      const { container } = render(
        <MarkdownContent content={`# Research Summary${c(1)}`} citations={sampleCitations} />
      );

      const heading = container.querySelector('h1');
      expect(heading).toBeInTheDocument();
      expect(heading?.textContent).not.toContain(c(1));

      const chicletLink = heading?.querySelector('span > a');
      expect(chicletLink).toHaveAttribute('href', 'https://example.com/research');
    });

    it('should de-duplicate chiclets when same citation appears twice', () => {
      const { container } = render(
        <MarkdownContent content={`Source${c(1)} again${c(1)}.`} citations={sampleCitations} />
      );

      const paragraph = container.querySelector('p');
      const chicletLinks = paragraph?.querySelectorAll('span > a');
      expect(chicletLinks).toHaveLength(1);
      expect(chicletLinks?.[0]).toHaveAttribute('href', 'https://example.com/research');
    });

    it('should de-duplicate chiclets when different citations have same URL', () => {
      const citationsWithDuplicateUrl: Citation[] = [
        {
          id: 'cite-1',
          number: 1,
          type: 'url',
          url: 'https://example.com/same-page',
          title: 'First Reference',
        },
        {
          id: 'cite-2',
          number: 2,
          type: 'url',
          url: 'https://example.com/same-page',
          title: 'Second Reference',
        },
      ];

      const { container } = render(
        <MarkdownContent content={`See${c(1)} and${c(2)}.`} citations={citationsWithDuplicateUrl} />
      );

      const paragraph = container.querySelector('p');
      const chicletLinks = paragraph?.querySelectorAll('span > a');
      expect(chicletLinks).toHaveLength(1);
      expect(chicletLinks?.[0]).toHaveAttribute('href', 'https://example.com/same-page');
    });

    it('should not be confused by bracket notation in text', () => {
      // Legacy [n] format should NOT be interpreted as citations
      const { container } = render(
        <MarkdownContent content={`Array access uses array[1] syntax.`} citations={sampleCitations} />
      );

      const paragraph = container.querySelector('p');
      // The [1] in array[1] should remain as-is since it's not a Unicode citation marker
      expect(paragraph?.textContent).toContain('array[1]');
      // No chiclets should be rendered since there are no Unicode markers
      const chicletLinks = paragraph?.querySelectorAll('span > a');
      expect(chicletLinks).toHaveLength(0);
    });
  });
});
