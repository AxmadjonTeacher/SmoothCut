import { describe, expect, it } from 'vitest';
import { createLineSplitter, parseRecorderLine } from './protocol.js';

describe('parseRecorderLine', () => {
  it('parses ready', () => {
    expect(parseRecorderLine('{"event":"ready","swiftMs":12345.678}')).toEqual({
      event: 'ready',
      swiftMs: 12345.678,
    });
  });

  it('parses firstFrame', () => {
    expect(parseRecorderLine('{"event":"firstFrame","swiftMs":12400.5,"ptsSec":8123.25}')).toEqual({
      event: 'firstFrame',
      swiftMs: 12400.5,
      ptsSec: 8123.25,
    });
  });

  it('parses cursorShape', () => {
    const line =
      '{"event":"cursorShape","swiftMs":13000,"shapeId":"da39a3ee5e6b4b0d3255bfef95601890afd80709",' +
      '"hotspotX":4,"hotspotY":4,"w":32,"h":32}';
    expect(parseRecorderLine(line)).toEqual({
      event: 'cursorShape',
      swiftMs: 13000,
      shapeId: 'da39a3ee5e6b4b0d3255bfef95601890afd80709',
      hotspotX: 4,
      hotspotY: 4,
      w: 32,
      h: 32,
    });
  });

  it('parses stats', () => {
    expect(parseRecorderLine('{"event":"stats","frames":120,"dropped":2}')).toEqual({
      event: 'stats',
      frames: 120,
      dropped: 2,
    });
  });

  it('parses stopped', () => {
    expect(parseRecorderLine('{"event":"stopped","durationMs":3016.7}')).toEqual({
      event: 'stopped',
      durationMs: 3016.7,
    });
  });

  it('parses error', () => {
    expect(parseRecorderLine('{"event":"error","message":"boom"}')).toEqual({
      event: 'error',
      message: 'boom',
    });
  });

  it('returns null for torn lines', () => {
    expect(parseRecorderLine('{"event":"ready","swi')).toBeNull();
  });

  it('returns null for unknown events', () => {
    expect(parseRecorderLine('{"event":"heartbeat","swiftMs":1}')).toBeNull();
  });

  it('returns null for known events with malformed payloads', () => {
    expect(parseRecorderLine('{"event":"ready"}')).toBeNull();
    expect(parseRecorderLine('{"event":"ready","swiftMs":"soon"}')).toBeNull();
    expect(parseRecorderLine('{"event":"stopped","durationMs":null}')).toBeNull();
    expect(parseRecorderLine('{"event":"cursorShape","swiftMs":1,"shapeId":"x"}')).toBeNull();
  });

  it('returns null for empty and non-object lines', () => {
    expect(parseRecorderLine('')).toBeNull();
    expect(parseRecorderLine('   ')).toBeNull();
    expect(parseRecorderLine('42')).toBeNull();
    expect(parseRecorderLine('[1,2]')).toBeNull();
    expect(parseRecorderLine('null')).toBeNull();
  });
});

describe('createLineSplitter', () => {
  it('reassembles lines split across chunks', () => {
    const lines: string[] = [];
    const splitter = createLineSplitter((line) => lines.push(line));
    splitter.push('{"event":"ready","sw');
    splitter.push('iftMs":123}\n{"event":"stats","fra');
    splitter.push('mes":1,"dropped":0}\n');
    expect(lines).toEqual([
      '{"event":"ready","swiftMs":123}',
      '{"event":"stats","frames":1,"dropped":0}',
    ]);
  });

  it('handles multiple lines in one chunk', () => {
    const lines: string[] = [];
    const splitter = createLineSplitter((line) => lines.push(line));
    splitter.push('a\nb\nc\n');
    expect(lines).toEqual(['a', 'b', 'c']);
  });

  it('flush surfaces a trailing partial line', () => {
    const lines: string[] = [];
    const splitter = createLineSplitter((line) => lines.push(line));
    splitter.push('tail-without-newline');
    expect(lines).toEqual([]);
    splitter.flush();
    expect(lines).toEqual(['tail-without-newline']);
    splitter.flush();
    expect(lines).toEqual(['tail-without-newline']);
  });
});
