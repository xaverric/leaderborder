export const MAX_NAME_LENGTH = 60;
const PRINTABLE = /^\P{C}+$/u;

export const defaultDeviceName = ({ arch = process.arch } = {}) => `Mac (${arch})`;

export const parseDeviceName = (value) => {
  const name = String(value ?? "").trim();
  return name.length > 0 && name.length <= MAX_NAME_LENGTH && PRINTABLE.test(name) ? name : null;
};
