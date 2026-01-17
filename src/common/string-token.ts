export const parseStringToken = (tokenValue: string): { value: string; isFString: boolean } => {
  let raw = tokenValue;
  let isFString = false;
  if (raw.startsWith('f') || raw.startsWith('F')) {
    isFString = true;
    raw = raw.slice(1);
  }
  const quote = raw[0];
  if (raw.startsWith(quote.repeat(3))) {
    const inner = raw.slice(3, -3);
    return { value: inner, isFString };
  }
  const inner = raw.slice(1, -1);
  return {
    value: inner.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\"/g, '"').replace(/\\'/g, "'"),
    isFString,
  };
};
