// Port of blunted/utils/xmlloader: a minimal tag tree parser for the game's XML-ish data.
//
// XMLTree.children mirrors the original std::multimap<std::string, XMLTree>: entries are kept
// ORDERED BY TAG NAME (lexicographically, so "p10" sorts before "p2"), and entries with equal
// tags keep insertion order. Iterate with `for (const [tag, child] of tree.children)`.

import { Log, e_FatalError } from '../base/log';

export class XMLTree {
  value = '';
  children: [string, XMLTree][] = [];

  /** multimap::insert */
  Insert(tag: string, child: XMLTree): void {
    let i = this.children.length;
    while (i > 0 && this.children[i - 1][0] > tag) i--;
    this.children.splice(i, 0, [tag, child]);
  }

  /** multimap::find: first child with this tag, or undefined */
  Find(tag: string): XMLTree | undefined {
    for (const [t, c] of this.children) if (t === tag) return c;
    return undefined;
  }

  /** multimap::equal_range */
  FindAll(tag: string): XMLTree[] {
    return this.children.filter(([t]) => t === tag).map(([, c]) => c);
  }

  /** value of child tag, or default */
  GetChildValue(tag: string, defaultValue = ''): string {
    const c = this.Find(tag);
    return c ? c.value : defaultValue;
  }
}

export class XMLLoader {
  Load(source: string): XMLTree {
    const tree = new XMLTree();
    this.BuildTree(tree, source);
    return tree;
  }

  GetSource(source: XMLTree, depth = 0): string {
    let result = '';
    if (source.children.length === 0) {
      if (source.value !== '') result += '\t'.repeat(depth) + source.value + '\n';
    } else {
      for (const [tag, child] of source.children) {
        result += '\t'.repeat(depth) + `<${tag}>\n`;
        result += this.GetSource(child, depth + 1);
        result += '\t'.repeat(depth) + `</${tag}>\n`;
      }
    }
    return result;
  }

  protected BuildTree(tree: XMLTree, source: string): void {
    let index = source.indexOf('<');
    if (index === -1) {
      tree.value = source.replace(/\s/g, '');
      return;
    }
    while (index !== -1) {
      let index_end = source.indexOf('>', index);
      const tag = source.substring(index + 1, index_end);
      index = index_end;
      let recurse_counter = 1;
      while (recurse_counter !== 0) {
        const open = source.indexOf('<' + tag + '>', index_end + 1);
        const close = source.indexOf('</' + tag + '>', index_end + 1);
        if (open === -1 || open > close) {
          recurse_counter--;
          index_end = close;
        } else {
          recurse_counter++;
          index_end = open;
        }
        if (index_end === -1) Log(e_FatalError, 'XMLLoader', 'BuildTree', `No closing tag found for <${tag}>`);
      }
      const data = source.substring(index + 1, index_end);
      const child = new XMLTree();
      this.BuildTree(child, data);
      tree.Insert(tag, child);
      index = source.indexOf('>', index_end);
      index = source.indexOf('<', index);
    }
  }
}
