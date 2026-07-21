import { createElement } from "react";

export function renderInline(text) {
  return String(text ?? "").split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) => {
    const match = /^\*\*([^*]+)\*\*$/.exec(part);
    return match ? createElement("strong", { key: index }, match[1]) : createElement("span", { key: index }, part);
  });
}
