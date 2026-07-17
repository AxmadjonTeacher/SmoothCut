import { describe, expect, it } from 'vitest';
import { pickAvcCodecString } from './support.js';

describe('pickAvcCodecString', () => {
  it('picks level 5.2 for 4K60', () => {
    expect(pickAvcCodecString(3840, 2160, 60)).toBe('avc1.640034');
  });

  it('picks level 5.1 for 4K30', () => {
    expect(pickAvcCodecString(3840, 2160, 30)).toBe('avc1.640033');
  });

  it('picks level 4.2 for 1080p60', () => {
    expect(pickAvcCodecString(1920, 1080, 60)).toBe('avc1.64002a');
  });

  it('picks level 4.0 for 1080p30', () => {
    expect(pickAvcCodecString(1920, 1080, 30)).toBe('avc1.640028');
  });

  it('picks level 5.1 for 1440p60', () => {
    expect(pickAvcCodecString(2560, 1440, 60)).toBe('avc1.640033');
  });

  it('picks level 3.0 for small captures', () => {
    expect(pickAvcCodecString(640, 480, 30)).toBe('avc1.64001e');
  });

  it('accounts for macroblock rounding on odd dimensions', () => {
    // 1927x1087 -> 121x68 macroblocks = 8228 > 8192 (level 4.0 MaxFS).
    expect(pickAvcCodecString(1927, 1087, 30)).toBe('avc1.64002a');
  });

  it('clamps to level 6.2 for inputs beyond every level', () => {
    expect(pickAvcCodecString(8192, 8192, 120)).toBe('avc1.64003e');
  });
});
