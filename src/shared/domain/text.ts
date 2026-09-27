const graphemes = new Intl.Segmenter("ja", { granularity: "grapheme" });

/**
 * 人が入力した文字列をそろえる。NFC で結合文字を 1 文字にまとめ（「か」+「゛」→「が」）、
 * 前後の空白（全角空白を含む）を落とす。
 */
export const normalizeText = (raw: string) => raw.normalize("NFC").trim();

/** 見た目の文字数（書記素クラスタ）。絵文字の「👨‍👩‍👧」も 1 文字と数える */
export const graphemeLength = (text: string) => [...graphemes.segment(text)].length;

/** 制御文字（NUL・タブ・改行など）を含むか。allowNewline なら改行だけは許す */
export const hasControlCharacters = (text: string, options: { allowNewline?: boolean } = {}) =>
  [...text].some((char) => /\p{Cc}/u.test(char) && !(options.allowNewline && char === "\n"));
