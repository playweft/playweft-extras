// Keep every input guide readable without JavaScript; enhance to accessible tabs.
for (const section of document.querySelectorAll('[data-control-tabs]')) {
  const list = section.querySelector('[role="tablist"]');
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  const panels = tabs.map((tab) =>
    document.getElementById(tab.getAttribute('aria-controls')),
  );
  function select(index, focus = false) {
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      panels[i].hidden = i !== index;
    });
    if (focus) tabs[index].focus({ preventScroll: true });
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(index));
    tab.addEventListener('keydown', (event) => {
      const next = {
        ArrowRight: (index + 1) % tabs.length,
        ArrowLeft: (index + tabs.length - 1) % tabs.length,
        Home: 0,
        End: tabs.length - 1,
      }[event.key];
      if (next === undefined || event.altKey || event.ctrlKey || event.metaKey)
        return;
      event.preventDefault();
      select(next, true);
    });
  });
  select(0);
  section.dataset.tabsReady = '';
  list.hidden = false;
}
