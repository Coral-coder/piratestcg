// Small DOM helpers.
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v as Record<string, string>)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv);
        else (el.style as unknown as Record<string, string>)[sk] = sv;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'html') el.innerHTML = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function clear(el: HTMLElement) {
  while (el.firstChild) el.firstChild.remove();
}

let toastHost: HTMLElement | null = null;
export function toast(text: string, kind: 'info' | 'good' | 'bad' = 'info', ms = 2200) {
  if (!toastHost || !toastHost.isConnected) {
    toastHost = h('div', { class: 'toasts' });
    document.body.append(toastHost);
  }
  const t = h('div', { class: `toast ${kind}` }, text);
  toastHost.append(t);
  while (toastHost.children.length > 3) toastHost.firstChild!.remove();
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

export function modal(title: string, body: Child, actions: { label: string; primary?: boolean; onClick: () => void }[]): HTMLElement {
  const back = h('div', { class: 'modal-back' });
  const close = () => back.remove();
  const box = h(
    'div',
    { class: 'modal', role: 'dialog', 'aria-label': title },
    h('h2', {}, title),
    body,
    h('div', { class: 'modal-actions' }, ...actions.map((a) => h('button', { class: a.primary ? 'btn primary' : 'btn', onClick: () => { close(); a.onClick(); } }, a.label))),
  );
  back.append(box);
  document.body.append(back);
  return back;
}

export function dieFace(rank: number, bar: 'S' | 'L' | null, extra = ''): HTMLElement {
  return h('span', { class: `die ${bar === 'L' ? 'die-l' : 'die-s'} ${extra}`, title: bar ? `Rank ${rank}, ${bar === 'L' ? 'long' : 'short'} range` : String(rank) }, h('b', {}, String(rank)), bar ? h('i', {}, bar) : null);
}
