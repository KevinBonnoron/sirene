/** The studio lives at the root, so only it matches exactly; a section owns its subtree. */
export function isSectionActive(currentPath: string, href: string): boolean {
  if (href === '/') {
    return currentPath === '/';
  }
  return currentPath === href || currentPath.startsWith(`${href}/`);
}
