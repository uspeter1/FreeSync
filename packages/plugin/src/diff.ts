export function minimalDiff(oldText: string, newText: string) {
  let start = 0;
  while (start < oldText.length && start < newText.length && oldText[start] === newText[start]) {
    start++;
  }
  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (oldEnd > start && newEnd > start && oldText[oldEnd - 1] === newText[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  return {
    index: start,
    deleteCount: oldEnd - start,
    insertText: newText.slice(start, newEnd),
  };
}
