import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  ViewEncapsulation,
  afterNextRender,
  booleanAttribute,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  Editor,
  Extension,
  Mark,
  markInputRule,
  markPasteRule,
  mergeAttributes,
} from '@tiptap/core';
import type { MarkType } from '@tiptap/pm/model';
import { Slice } from '@tiptap/pm/model';
import { EditorState, Plugin, Selection, TextSelection, type Transaction } from '@tiptap/pm/state';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import HardBreak from '@tiptap/extension-hard-break';
import Bold, {
  starInputRegex as boldInput,
  starPasteRegex as boldPaste,
} from '@tiptap/extension-bold';
import Italic, { starInputRegex, starPasteRegex } from '@tiptap/extension-italic';
import { Placeholder, UndoRedo } from '@tiptap/extensions';
import { parseProse, serialiseProse, speechRuns } from '../core/prose-markdown';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    speech: {
      /** Quotes around the selection, or an empty pair to write into. */
      quote: () => ReturnType;
    };
  }
}

// ---------------------------------------------------------------------------
// The schema: what a message can be while it is being written.
// ---------------------------------------------------------------------------

/** Only the asterisk spelling; `__this__` stays the writer's own characters. */
const StarBold = Bold.extend({
  addInputRules() {
    return [markInputRule({ find: boldInput, type: this.type })];
  },
  addPasteRules() {
    return [markPasteRule({ find: boldPaste, type: this.type })];
  },
});

/**
 * The italic that reads as an action, drawn the way the page draws it. It is
 * Italic under another name — Mod-i, the `*…*` input rule and the paste rule
 * are all inherited — so that `toggleItalic` toggles it.
 */
const Action = Italic.extend({
  name: 'action',
  renderHTML({ HTMLAttributes }) {
    return ['em', mergeAttributes(HTMLAttributes, { class: 'action' }), 0];
  },
  addInputRules() {
    return [markInputRule({ find: starInputRegex, type: this.type })];
  },
  addPasteRules() {
    return [markPasteRule({ find: starPasteRegex, type: this.type })];
  },
});

/**
 * Speech is a colour, not a mark the writer applies: whatever sits between a
 * pair of quotes is speech, the moment the pair closes. So the mark is worked
 * out from the text after every change, by the rule the page reads with, and
 * the only command is one that puts the quotes there.
 */
const Speech = Mark.create({
  name: 'speech',
  inclusive: false,
  parseHTML() {
    return [{ tag: 'span.speech' }];
  },
  renderHTML() {
    return ['span', { class: 'speech' }, 0];
  },
  addCommands() {
    return {
      quote:
        () =>
        ({ tr, dispatch }) => {
          const { from, to, empty } = tr.selection;
          if (dispatch) {
            if (empty) {
              tr.insertText('""', from);
              tr.setSelection(TextSelection.create(tr.doc, from + 1));
            } else {
              tr.insertText('"', to);
              tr.insertText('"', from);
              tr.setSelection(TextSelection.create(tr.doc, from + 1, to + 1));
            }
          }
          return true;
        },
    };
  },
  addKeyboardShortcuts() {
    return { "Mod-'": () => this.editor.commands.quote() };
  },
  addProseMirrorPlugins() {
    const type = this.type;
    return [
      new Plugin({
        appendTransaction: (transactions, _old, state) =>
          transactions.some((tr) => tr.docChanged) ? respeak(state, type) : null,
      }),
    ];
  },
});

/**
 * Re-derives the speech marks of every paragraph and returns the transaction
 * that fixes them, or null when there is nothing to fix — which is also what
 * stops it from answering itself forever.
 *
 * The stretches are the same ones `prose-markdown` uses: text sharing one set
 * of marks, ended by a break or by an action or bold run. A quote is never
 * matched across one of those, because the page would not either.
 */
function respeak(state: EditorState, type: MarkType): Transaction | null {
  const tr = state.tr;
  let fixed = 0;

  state.doc.descendants((paragraph, pos) => {
    if (!paragraph.isTextblock) return true;
    const wanted: [number, number][] = [];
    const current: [number, number][] = [];
    let group: { from: number; text: string }[] = [];
    let groupKey = '';
    let offset = pos + 1;

    const flush = () => {
      const first = group[0];
      if (!first) return;
      const base = first.from;
      const text = group.map((part) => part.text).join('');
      for (const [from, to] of speechRuns(text)) push(wanted, base + from, base + to);
      group = [];
    };

    paragraph.forEach((child) => {
      if (child.isText) {
        const key = child.marks
          .filter((mark) => mark.type !== type)
          .map((mark) => mark.type.name)
          .sort()
          .join(',');
        if (group.length && key !== groupKey) flush();
        groupKey = key;
        group.push({ from: offset, text: child.text ?? '' });
        if (type.isInSet(child.marks)) push(current, offset, offset + child.nodeSize);
      } else {
        flush();
      }
      offset += child.nodeSize;
    });
    flush();

    if (!sameRanges(wanted, current)) {
      fixed++;
      tr.removeMark(pos + 1, pos + 1 + paragraph.content.size, type);
      for (const [from, to] of wanted) tr.addMark(from, to, type.create());
    }
    return false;
  });

  return fixed > 0 ? tr : null;
}

/** Appends a range, merging it into the last one when they touch. */
function push(ranges: [number, number][], from: number, to: number): void {
  const last = ranges[ranges.length - 1];
  if (last?.[1] === from) last[1] = to;
  else ranges.push([from, to]);
}

function sameRanges(a: [number, number][], b: [number, number][]): boolean {
  return (
    a.length === b.length &&
    // Once the first half has matched, `b[i]` is known to be there.
    a.every(([from, to], i) => from === b[i]?.[0] && to === b[i][1])
  );
}

/** Shift+Enter only: Ctrl+Enter is the page's, for regenerate and for save. */
const ShiftBreak = HardBreak.extend({
  addKeyboardShortcuts() {
    return { 'Shift-Enter': () => this.editor.commands.setHardBreak() };
  },
});

/** Enter, asked before anything else gets it. */
const EnterKey = Extension.create<{ onEnter: () => boolean }>({
  name: 'enterKey',
  priority: 1000,
  addKeyboardShortcuts() {
    return { Enter: () => this.options.onEnter() };
  },
});

// ---------------------------------------------------------------------------
// The component
// ---------------------------------------------------------------------------

/**
 * Where the prose is written: the composer's box and a message being edited.
 *
 * A surface that grows with its content by construction, keeps its own undo
 * history, and shows speech in the speech colour and actions in italics while
 * they are typed — set with the page's own `.story-prose` rules, so what is
 * written looks like what will be read. In and out it is the markdown string a
 * message has always been (`prose-markdown.ts`); nothing about storage knows
 * this exists.
 *
 * `value` is the document's word on what the text is. The editor emits every
 * change through `valueChange`, and a `value` that comes back saying something
 * else — the box cleared after Send, the prose left of an `[AUTHOR]` split, a
 * message opened for editing — replaces the content *and the history*, so undo
 * can never bring back what was deliberately taken out.
 */
@Component({
  selector: 'li-prose-editor',
  template: `<div #host></div>`,
  // The editor's DOM is made by ProseMirror, not by this template, so the
  // styles have to reach it without Angular's scoping attribute: global, and
  // kept under this element's name.
  encapsulation: ViewEncapsulation.None,
  styles: `
    li-prose-editor {
      display: block;
      min-width: 0;
    }

    li-prose-editor .ProseMirror {
      position: relative;
      min-height: calc(var(--rows-min, 3) * 1lh);
      max-height: calc(var(--rows-max, 14) * 1lh);
      overflow-y: auto;
      white-space: pre-wrap;
      color: var(--li-ink);
      outline: none;
    }

    li-prose-editor .ProseMirror p.is-editor-empty:first-child::before {
      content: attr(data-placeholder);
      float: left;
      height: 0;
      color: var(--li-muted);
      pointer-events: none;
    }
  `,
})
export class ProseEditor {
  /** The text, as markdown. */
  readonly value = input('');
  readonly placeholder = input('');
  /** The box's name for a screen reader; the placeholder when there is none. */
  readonly label = input('');
  /** Enter sends instead of starting a paragraph; Shift+Enter breaks the line either way. */
  readonly submitOnEnter = input(false, { transform: booleanAttribute });
  /** Focused with the caret at the end as soon as it exists. */
  readonly autofocus = input(false, { transform: booleanAttribute });

  readonly valueChange = output<string>();
  /** Enter, when `submitOnEnter` is set. */
  readonly enter = output();

  /** Whether the selection is in a run of each kind, for a toolbar to show. */
  readonly bold = signal(false);
  readonly action = signal(false);

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private readonly injector = inject(Injector);
  private editor?: Editor;
  /** The last markdown the editor either emitted or was given: what it says now. */
  private current = '';

  constructor() {
    afterNextRender(() => this.mount());

    effect(() => {
      const value = this.value();
      if (this.editor && value !== this.current) this.reset(value);
    });

    // The placeholder is read when the view redraws; an empty transaction is
    // what asks it to. The label is the box's name, and the placeholder stands
    // in for it when there is none.
    effect(() => {
      const label = this.label() || this.placeholder();
      const editor = this.editor;
      if (!editor) return;
      editor.view.dom.setAttribute('aria-label', label);
      editor.view.dispatch(editor.state.tr);
    });

    inject(DestroyRef).onDestroy(() => this.editor?.destroy());
  }

  focus(): void {
    this.editor?.commands.focus('end');
  }

  /**
   * Shows `markdown` now, history and all forgotten, without waiting for the
   * binding to come round. For a host that answers a change by handing back
   * something else in the same breath — the `[AUTHOR]` split — so that the
   * next keystroke cannot land on the text that was just taken out.
   */
  show(markdown: string): void {
    if (this.editor && markdown !== this.current) this.reset(markdown);
  }

  /** Types `text` at the end, as a keystroke would, and leaves the caret there. */
  insertText(text: string): void {
    const editor = this.editor;
    if (!editor) return;
    const { state, view } = editor;
    view.dispatch(
      state.tr.setSelection(Selection.atEnd(state.doc)).insertText(text).scrollIntoView(),
    );
    view.focus();
  }

  toggleBold(): void {
    this.editor?.chain().focus().toggleBold().run();
  }

  toggleAction(): void {
    this.editor?.chain().focus().toggleMark('action').run();
  }

  quote(): void {
    this.editor?.chain().focus().quote().run();
  }

  private mount(): void {
    this.current = this.value();
    const editor = new Editor({
      element: this.host().nativeElement,
      injectCSS: false,
      extensions: [
        Document,
        Paragraph,
        Text,
        ShiftBreak,
        StarBold,
        Action,
        Speech,
        UndoRedo,
        Placeholder.configure({ placeholder: () => this.placeholder() }),
        EnterKey.configure({
          onEnter: () => {
            if (!this.submitOnEnter()) return false;
            this.enter.emit();
            return true;
          },
        }),
      ],
      content: parseProse(this.current),
      editorProps: {
        // A plain object: Tiptap merges its own class into these, and loses a
        // function. The label changes, so it is written straight to the node.
        attributes: { class: 'story-prose', role: 'textbox', 'aria-multiline': 'true' },
        // Plain text, read as the markdown it is; whatever else the clipboard
        // holds — a web page's HTML, its styles — is left on the clipboard.
        handlePaste: (view, event) => {
          const text = event.clipboardData?.getData('text/plain').replace(/\r\n?/g, '\n');
          if (!text) return false;
          const doc = view.state.schema.nodeFromJSON(parseProse(text));
          view.dispatch(
            view.state.tr.replaceSelection(new Slice(doc.content, 1, 1)).scrollIntoView(),
          );
          return true;
        },
        // A closing quote typed in front of the one already waiting there
        // steps over it, so writing into an empty pair ends where it should.
        handleTextInput: (view, from, to, text) => {
          if (text !== '"' || from !== to) return false;
          if (view.state.doc.textBetween(from, from + 1) !== '"') return false;
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from + 1)));
          return true;
        },
      },
      onUpdate: () => {
        const markdown = serialiseProse(editor.getJSON());
        if (markdown === this.current) return;
        this.current = markdown;
        this.valueChange.emit(markdown);
        // The document has the last word. Once the host has rendered its
        // answer, a `value` that still differs from what was said is a
        // refusal, and the box shows the value — even when the signal behind
        // it did not change, which is what the effect below cannot see: the
        // `[AUTHOR]` split hands back the same prose twice in a row.
        afterNextRender(() => this.settle(), { injector: this.injector });
      },
      onTransaction: () => this.readMarks(),
    });
    this.editor = editor;
    // The effect that keeps the label current ran before there was a node to
    // write it to; this is the first writing.
    editor.view.dom.setAttribute('aria-label', this.label() || this.placeholder());
    if (this.autofocus()) this.focus();
  }

  /**
   * New content and a clean slate: a fresh state with the same plugins is how
   * ProseMirror forgets its history, and the history is the point here.
   */
  private reset(markdown: string): void {
    const editor = this.editor!;
    this.current = markdown;
    const doc = editor.schema.nodeFromJSON(parseProse(markdown));
    editor.view.updateState(
      EditorState.create({ doc, plugins: editor.state.plugins, selection: Selection.atEnd(doc) }),
    );
    this.readMarks();
  }

  private settle(): void {
    const value = this.value();
    if (this.editor && value !== this.current) this.reset(value);
  }

  private readMarks(): void {
    const editor = this.editor;
    if (!editor) return;
    this.bold.set(editor.isActive('bold'));
    this.action.set(editor.isActive('action'));
  }
}
