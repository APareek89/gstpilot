// Type declaration for pdf-parse's deep import (the package ships no types for it).
// We import the inner module directly to skip the package's debug harness, which tries
// to read a test PDF whenever it thinks it's being run standalone.
declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfParseResult {
    numpages: number;
    text: string;
  }
  function pdfParse(buffer: Buffer, options?: { max?: number }): Promise<PdfParseResult>;
  export default pdfParse;
}
