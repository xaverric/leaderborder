const round = (n) => Math.round(n * 10) / 10;

export const sparklinePath = (values = [], { width, height, pad = 0 }) => {
  if (!values.length) return "";
  const series = values.length === 1 ? [values[0], values[0]] : values;
  const max = Math.max(...series);
  const min = Math.min(0, ...series);
  const span = max - min;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const x = (i) => round(pad + (innerW * i) / (series.length - 1));
  const y = (v) => round(span > 0 ? pad + innerH - ((v - min) / span) * innerH : height - pad);
  return series.map((v, i) => `${i ? "L" : "M"}${x(i)} ${y(v)}`).join("");
};
