declare module 'opentype.js' {
  export type Command = { type: 'M' | 'L' | 'Q' | 'C' | 'Z'; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }
  export type Glyph = { advanceWidth?: number; path: { commands: Command[] } }
  export type Font = {
    unitsPerEm: number
    charToGlyph(char: string): Glyph
    getKerningValue(left: Glyph, right: Glyph): number
  }
  const opentype: { parse(buffer: ArrayBuffer): Font }
  export default opentype
}
