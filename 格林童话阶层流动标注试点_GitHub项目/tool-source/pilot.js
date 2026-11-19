'use strict';

const data = JSON.parse(document.getElementById('pilot-data').textContent);
const { people, tales, fields, headers, guide } = data;
const roles = Object.keys(people);
const $ = (id) => document.getElementById(id);
const form = $('annotation-form');
const storagePrefix = 'cus6043-grimm/pilot-v1/';
const readerModeKey = storagePrefix + 'reader-mode';
const readerModes = {
  bilingual: '童话中英对照全文',
  english: '童话英文全文',
  chinese: '童话中文译文',
};
const comparisonFields = ['app', 'start', 'end', 'movement', 'method'];
const fieldLabel = Object.fromEntries(fields.map(({ key, label }) => [key, label]));
const fieldNames = new Set(fields.map(({ key }) => key));
const received = new Map();
const blank = () => Object.fromEntries(fields.map(({ key }) => [key, '']));
const html = (value) => String(value ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let activeRole = '';
let currentIndex = 0;
let records = {};
let activeView = 'home';
let storageWorks = true;

function message(id, text = '') {
  $(id).textContent = text;
  $(id).hidden = !text;
}

function show(view) {
  activeView = view;
  for (const section of ['home', 'workspace', 'review']) $(section).hidden = section !== view;
  $('identity').hidden = view !== 'workspace';
  $('switch-user').hidden = view !== 'workspace';
  if (view === 'home') $('name').focus();
}

function storageKey() {
  return storagePrefix + activeRole + '/' + people[activeRole];
}

function normalize(row = {}) {
  const clean = blank();
  for (const field of fields) {
    const value = typeof row[field.key] === 'string' ? row[field.key] : '';
    clean[field.key] = !field.options || field.options.includes(value) ? value : '';
  }
  if (clean.app !== '适用') {
    for (const { key } of fields.slice(1)) clean[key] = '';
  }
  return clean;
}

function readStorage() {
  const value = JSON.parse(localStorage.getItem(storageKey()) || '{}');
  return Object.fromEntries(tales.filter(({ khm }) => value[khm]).map(({ khm }) => [khm, normalize(value[khm])]));
}

function missing(record) {
  if (!record?.app) return [fields[0]];
  if (record.app === '不适用') return [];
  return fields.slice(1, -1).filter(({ key }) => !record[key].trim());
}

function progressOf(record) {
  if (!record?.app) return 'empty';
  return missing(record).length ? 'draft' : 'complete';
}

function persist(changes) {
  if (storageWorks) {
    try {
      const merged = { ...readStorage(), ...changes };
      localStorage.setItem(storageKey(), JSON.stringify(merged));
      records = merged;
      return;
    } catch {
      storageWorks = false;
    }
  }
  records = { ...records, ...changes };
}

function start(role) {
  activeRole = role;
  storageWorks = true;
  try {
    records = readStorage();
    localStorage.setItem(storageKey(), JSON.stringify(records));
  } catch {
    storageWorks = false;
    records = {};
  }
  $('identity').textContent = people[role] + ' · 组员 ' + role;
  show('workspace');
  const next = tales.findIndex(({ khm }) => progressOf(records[khm]) !== 'complete');
  openTale(Math.max(0, next), true);
}

function renderProgress() {
  const descriptions = { empty: '未开始', draft: '草稿', complete: '已完成' };
  let total = 0;
  for (const [index, { khm, title }] of tales.entries()) {
    const state = progressOf(records[khm]);
    if (state === 'complete') total++;
    const button = $('task-list').children[index].firstElementChild;
    const dot = button.querySelector('.task-state');
    const accessibleLabel = 'KHM ' + khm + ' ' + title + ' · ' + descriptions[state];
    if (button.getAttribute('aria-label') !== accessibleLabel) button.setAttribute('aria-label', accessibleLabel);
    if (index === currentIndex) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
    dot.className = 'task-state ' + state;
    $('jump').options[index].textContent = 'KHM ' + khm + ' · ' + title + ' · ' + descriptions[state];
  }
  const progressText = '已完成 ' + total + ' / ' + tales.length + ' 篇';
  if ($('progress-text').textContent !== progressText) $('progress-text').textContent = progressText;
  $('progress').max = tales.length;
  $('progress').value = total;
  $('jump').value = String(currentIndex);
  $('export-final').disabled = total !== tales.length;
  $('export-hint').textContent = total === tales.length ? '可导出并交给负责人。' : '完成全部篇目后可导出。';
  const status = $('saved-status');
  status.classList.toggle('failure', !storageWorks);
  const currentState = progressOf(records[tales[currentIndex].khm]);
  const caption = !storageWorks ? '无法保存到浏览器，请备份 CSV' :
    { empty: '未开始', draft: '草稿已保存', complete: '已完成 · 已保存' }[currentState];
  if (status.textContent !== caption) status.textContent = caption;
}

function fillForm(record) {
  for (const input of form.querySelectorAll('input[name="app"]')) {
    input.checked = input.value === record.app;
  }
  for (const { key } of fields.slice(1)) {
    form.elements.namedItem(key).value = record[key];
  }
  const applicable = record.app === '适用';
  $('applicable-fields').hidden = !applicable;
  $('applicable-fields').disabled = !applicable;
  message('rule-hint', record.app === '不适用' ? '已选择不适用。按编码说明，其余字段留空。' : '');
}

function setReaderMode(mode, keepPosition = false) {
  if (!Object.hasOwn(readerModes, mode)) mode = 'bilingual';
  const body = $('story-body');
  const top = body.getBoundingClientRect().top;
  const anchor = keepPosition && body.scrollTop > 0
    ? [...body.children].find((pair) => pair.getBoundingClientRect().bottom > top + 1)
    : null;
  $('reader').dataset.mode = mode;
  body.setAttribute('aria-label', readerModes[mode]);
  $('reader-modes').querySelector('input[value="' + mode + '"]').checked = true;
  if (anchor) body.scrollTop += anchor.getBoundingClientRect().top - top;
}

function renderStory(tale) {
  $('story-title-en').textContent = tale.title;
  $('story-title-zh').textContent = tale.titleZh;
  $('story-source').textContent = 'Margaret Hunt 英译 · ' + tale.file;
  $('story-body').replaceChildren(...tale.paragraphs.map((text, index) => {
    const pair = document.createElement('div');
    pair.className = 'reading-pair';
    const english = document.createElement('p');
    english.className = 'english-copy';
    english.lang = 'en';
    english.textContent = text;
    const chinese = document.createElement('p');
    chinese.className = 'chinese-copy';
    chinese.lang = 'zh-CN';
    chinese.textContent = tale.paragraphsZh[index];
    pair.append(english, chinese);
    return pair;
  }));
  $('story-body').scrollTop = 0;
}

function openTale(index, focus = false) {
  currentIndex = index;
  const tale = tales[index];
  $('story-id').textContent = 'KHM ' + tale.khm + ' · 第 ' + (index + 1) + ' / ' + tales.length + ' 篇';
  renderStory(tale);
  $('annotation').scrollTop = 0;
  fillForm(records[tale.khm] ?? blank());
  $('previous').disabled = index === 0;
  $('save-next').textContent = index === tales.length - 1 ? '保存本篇' : '保存并下一篇';
  message('form-error');
  renderProgress();
  $('task-list').children[index].firstElementChild.scrollIntoView({ block: 'nearest' });
  if (focus) $('story-title').focus({ preventScroll: !window.matchMedia('(max-width: 650px)').matches });
}

function saveField(event) {
  const key = event.target.name;
  if (!fieldNames.has(key)) return;
  const { khm } = tales[currentIndex];
  let latest = records;
  if (storageWorks) {
    try {
      latest = readStorage();
    } catch {
      storageWorks = false;
    }
  }
  const current = latest[khm] ?? blank();
  const value = event.target.value;
  if (key === 'app' && value === '不适用' && fields.slice(1).some((field) => current[field.key])) {
    if (!window.confirm('选择不适用会清空本篇的其余答案。确认更改？')) {
      fillForm(current);
      return;
    }
  }
  const next = normalize({ ...current, [key]: value });
  persist({ [khm]: next });
  if (key === 'app') fillForm(next);
  message('form-error');
  renderProgress();
}

function setupForm() {
  const [app, ...other] = fields;
  const required = ' <span class="necessary" aria-hidden="true">*</span>';
  const choices = app.options.map((choice) => '<label><input type="radio" name="app" value="' +
    html(choice) + '" required> ' + html(choice) + '</label>').join('');
  const controls = other.map(({ key, label, options }) => {
    const attrs = 'id="field-' + key + '" name="' + key + '"';
    let control;
    if (options) {
      control = '<select ' + attrs + ' required><option value="">请选择</option>' + options.map((value) =>
        '<option value="' + html(value) + '">' + html(value) + '</option>').join('') + '</select>';
    } else if (key === 'notes') {
      control = '<textarea ' + attrs + ' rows="2" placeholder="记录判断依据或需要讨论的地方"></textarea>';
    } else {
      control = '<input ' + attrs + ' required placeholder="英文名或身份">';
    }
    const wide = ['person', 'method', 'notes'].includes(key) ? ' field-wide' : '';
    return '<div class="field' + wide + '"><label for="field-' + key + '">' +
      html(label) + (key === 'notes' ? '' : required) + '</label>' + control + '</div>';
  }).join('');
  $('annotation-fields').innerHTML = '<fieldset><legend>' + html(app.label) + required +
    '</legend><div class="choice-row">' + choices + '</div></fieldset>' +
    '<p class="form-instruction" id="rule-hint" hidden></p>' +
    '<fieldset id="applicable-fields" aria-label="适用篇目的标注字段" hidden><div class="field-grid">' +
    controls + '</div></fieldset>';
}

// Preserve free text even when a spreadsheet would interpret its first characters as a formula.
const spreadsheetPrefix = /^(?:'|[\t\r\n]|[\s\uFEFF]*[=+\-@])/;
function spreadsheetText(value) {
  return spreadsheetPrefix.test(value) ? "'" + value : value;
}

function restoreText(value) {
  return value.startsWith("'") && spreadsheetPrefix.test(value.slice(1)) ? value.slice(1) : value;
}

function exportRows(filename, grid) {
  const contents = '\uFEFF' + grid.map((row) => row.map((value) => {
    const cell = spreadsheetText(String(value ?? ''));
    return '"' + cell.replace(/"/g, '""') + '"';
  }).join(',')).join('\r\n') + '\r\n';
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportRow(tale, role, row) {
  return [tale.khm, tale.title, people[role], ...fields.map(({ key }) => row[key])];
}

function personalExport(isFinal) {
  if (isFinal && tales.some(({ khm }) => progressOf(records[khm]) !== 'complete')) return;
  const name = (isFinal ? '试点标注' : '试点草稿') + '_' + activeRole + '_' + people[activeRole] + '.csv';
  exportRows(name, [headers, ...tales.map((tale) => exportRow(tale, activeRole, records[tale.khm] ?? blank()))]);
}

function parseCsv(text) {
  const source = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let part = '';
  let mode = 'start';
  const finishCell = () => {
    row.push(part);
    part = '';
    mode = 'start';
  };
  const finishRow = () => {
    finishCell();
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (mode === 'quoted') {
      if (char === '"' && source[index + 1] === '"') {
        part += '"';
        index++;
      } else if (char === '"') {
        mode = 'closed';
      } else {
        part += char;
      }
    } else if (char === ',') {
      finishCell();
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && source[index + 1] === '\n') index++;
      finishRow();
    } else if (char === '"' && mode === 'start') {
      mode = 'quoted';
    } else if (char === '"' || mode === 'closed') {
      throw Error('CSV 引号格式有误，请使用工具直接导出的文件。');
    } else {
      mode = 'plain';
      part += char;
    }
  }
  if (mode === 'quoted') throw Error('CSV 引号未闭合。');
  if (mode !== 'start' || row.length) finishRow();
  return rows;
}

async function readPersonal(file, requireComplete) {
  const [head, ...rows] = parseCsv(await file.text());
  if (!head || head.length !== headers.length || !headers.every((value, i) => head[i] === value)) {
    throw Error('表头与试点标注表不符，请导入个人试点 CSV。');
  }
  if (rows.length !== tales.length) throw Error('个人文件应包含同一位组员的全部 20 篇。');
  const role = roles.find((letter) => rows[0][2] === people[letter]);
  if (!role || rows.some((row) => row[2] !== people[role])) throw Error('标注者姓名不在名单中或存在多位标注者。');
  const entries = {};
  for (const row of rows) {
    const [khm, title, , ...values] = row;
    const tale = tales.find((item) => item.khm === khm);
    if (row.length !== headers.length || !tale || tale.title !== title || entries[khm]) {
      throw Error('KHM ' + khm + ' 的篇目、列数或重复记录有误。');
    }
    const answer = Object.fromEntries(fields.map(({ key, options }, index) => {
      const value = restoreText(values[index]);
      if (value && options && !options.includes(value)) throw Error('KHM ' + khm + ' 的' + fieldLabel[key] + '超出编码选项。');
      return [key, value];
    }));
    if (answer.app !== '适用' && values.slice(1).some(Boolean)) {
      throw Error('KHM ' + khm + ' 仅在适用时可填写其余字段。');
    }
    if (requireComplete && missing(answer).length) throw Error('KHM ' + khm + ' 尚未完成，请提交完整试点 CSV。');
    entries[khm] = answer;
  }
  return { role, entries };
}

async function restoreBackup(file) {
  const roleAtStart = activeRole;
  try {
    const { role, entries } = await readPersonal(file, false);
    if (activeView !== 'workspace' || activeRole !== roleAtStart) return;
    if (role !== activeRole) throw Error('该备份属于另一位组员，请切换姓名。');
    const changes = Object.fromEntries(Object.entries(entries).filter(([, record]) => record.app));
    if (!Object.keys(changes).length) throw Error('备份里没有已填写的篇目。');
    if (Object.keys(changes).some((khm) => records[khm]?.app && JSON.stringify(records[khm]) !== JSON.stringify(changes[khm]))) {
      if (!window.confirm('备份中已有答案的篇目将覆盖本机对应答案。确认导入？')) return;
    }
    persist(changes);
    openTale(currentIndex);
    message('form-error', '已导入 ' + Object.keys(changes).length + ' 篇。');
    $('form-error').classList.remove('error');
    $('form-error').classList.add('muted');
  } catch (error) {
    $('form-error').classList.remove('muted');
    $('form-error').classList.add('error');
    message('form-error', error.message);
  }
}

function compare(tale) {
  const choices = roles.map((role) => received.get(role)[tale.khm]);
  const counts = comparisonFields.map((key) => new Set(choices.map((row) => row[key]).filter(Boolean)).size);
  const conflictFields = comparisonFields.filter((_, index) => counts[index] > 1);
  return { counts, conflictFields };
}

function reviewTable(tale, conflicts) {
  const head = ['标注者', ...fields.map(({ label }) => label)];
  const names = head.map((label) => '<th scope="col">' + html(label) + '</th>').join('');
  const entries = roles.map((role) => {
    const row = received.get(role)[tale.khm];
    const cells = fields.map(({ key }) => '<td' + (conflicts.includes(key) ? ' class="conflict-cell"' : '') + '>' +
      html(row[key] || '—') + '</td>').join('');
    return '<tr><td>' + html(people[role]) + ' · ' + role + '</td>' + cells + '</tr>';
  }).join('');
  return '<div class="table-scroll" tabindex="0" aria-label="六人标注明细"><table><thead><tr>' + names +
    '</tr></thead><tbody>' + entries + '</tbody></table></div>';
}

function renderReview() {
  const done = received.size === roles.length;
  $('review-progress').textContent = '已收齐 ' + received.size + ' / ' + roles.length + ' 份。' +
    (done ? ' 可以查看和导出结果。' : ' 收齐后显示逐篇结果。');
  $('review-roles').innerHTML = roles.map((role) => '<li' + (received.has(role) ? ' class="received"' : '') + '>' +
    role + ' · ' + html(people[role]) + ' · ' + (received.has(role) ? '已收到' : '待导入') + '</li>').join('');
  $('export-review').disabled = !done;
  $('export-disagreements').disabled = !done;
  $('review-results').hidden = !done;
  if (!done) return;

  const comparisons = tales.map((tale) => [tale, compare(tale)]);
  const conflictCount = comparisons.filter(([, result]) => result.conflictFields.length).length;
  $('result-title').textContent = conflictCount + ' 篇有分歧 · ' + (tales.length - conflictCount) + ' 篇一致';
  const only = $('only-disagreements').checked;
  const details = comparisons.filter(([, result]) => !only || result.conflictFields.length).map(([tale, result]) => {
    const hasConflict = Boolean(result.conflictFields.length);
    return '<details class="review-result" data-conflict="' + hasConflict + '"><summary><strong>' +
      (hasConflict ? '分歧' : '一致') + '</strong> · KHM ' + html(tale.khm) + ' ' + html(tale.title) +
      (hasConflict ? '<small>' + result.conflictFields.map((key) => html(fieldLabel[key])).join('、') + '</small>' : '') +
      '</summary>' + reviewTable(tale, result.conflictFields) + '</details>';
  });
  $('review-table').innerHTML = details.join('') || '<p class="muted">这批结果没有分歧。</p>';
}

async function importReview(files) {
  const errors = [];
  for (const file of files) {
    try {
      const { role, entries } = await readPersonal(file, true);
      if (received.has(role) && JSON.stringify(received.get(role)) !== JSON.stringify(entries)) {
        if (!window.confirm('已导入 ' + people[role] + ' 的一份结果。用新文件替换？')) continue;
      }
      received.set(role, entries);
    } catch (error) {
      errors.push(file.name + ' · ' + error.message);
    }
  }
  message('review-error', errors.join('\n'));
  renderReview();
}

function setup() {
  setupForm();
  try {
    setReaderMode(localStorage.getItem(readerModeKey));
  } catch {
    setReaderMode('bilingual');
  }
  $('reader-modes').addEventListener('change', (event) => {
    const { value } = event.target;
    setReaderMode(value, true);
    try {
      localStorage.setItem(readerModeKey, value);
    } catch {
      // The selected mode still applies for this session.
    }
  });
  $('task-list').innerHTML = tales.map(({ khm, title }, index) => '<li><button type="button" class="task" data-index="' +
    index + '" title="' + html(title) + '"><span class="task-id">' + html(khm) + '</span>' +
    '<span class="task-title" lang="en">' + html(title) + '</span><span class="task-state" aria-hidden="true"></span></button></li>').join('');
  $('jump').replaceChildren(...tales.map((_, index) => new Option('', index)));
  $('guide-content').innerHTML = guide.map(([name, options, definition, example]) =>
    '<section class="guide-item"><h3>' + html(name) + '</h3>' + (options && options !== '—' ? '<p class="muted">' + html(options) + '</p>' : '') +
    '<p>' + html(definition) + '</p>' + (example ? '<p class="muted">' + html(example) + '</p>' : '') + '</section>').join('');

  function returnHome() {
    if (activeView === 'workspace' && !storageWorks && Object.values(records).some((row) => row.app) &&
        !window.confirm('本浏览器无法自动保存。离开前可先备份 CSV。仍要离开？')) return;
    activeRole = '';
    records = {};
    $('name').value = '';
    message('claim-error');
    show('home');
  }

  $('home-button').addEventListener('click', returnHome);
  $('switch-user').addEventListener('click', returnHome);
  $('review-back').addEventListener('click', returnHome);
  $('show-guide').addEventListener('click', () => $('guide').showModal());
  $('show-review').addEventListener('click', () => {
    show('review');
    renderReview();
    $('add-files').focus();
  });
  $('claim').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = $('name').value.normalize('NFKC').trim();
    const role = roles.find((letter) => people[letter] === name);
    if (role) start(role);
    else message('claim-error', '姓名未匹配。请检查是否输入了完整中文姓名。');
  });
  $('task-list').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-index]');
    if (button) openTale(Number(button.dataset.index), true);
  });
  $('jump').addEventListener('change', () => openTale(Number($('jump').value), true));
  $('previous').addEventListener('click', () => openTale(currentIndex - 1, true));
  form.addEventListener('input', (event) => {
    if (event.target.matches('input[type="text"], input:not([type]), textarea')) saveField(event);
  });
  form.addEventListener('change', (event) => {
    if (event.target.matches('select, input[type=radio]')) saveField(event);
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const absent = missing(records[tales[currentIndex].khm]);
    $('form-error').className = 'error';
    if (absent.length) {
      message('form-error', '请填写：' + absent.map(({ label }) => label).join('、') + '。');
      (absent[0].key === 'app' ? form.querySelector('[name="app"]') : form.elements.namedItem(absent[0].key)).focus();
    } else if (currentIndex < tales.length - 1) {
      openTale(currentIndex + 1, true);
    } else {
      const incomplete = tales.filter(({ khm }) => progressOf(records[khm]) !== 'complete').length;
      message('form-error', incomplete ? '本篇已完成，还有 ' + incomplete + ' 篇待完成。' : '20 篇已完成，可以导出试点 CSV。');
      $('form-error').className = 'muted';
    }
  });
  $('export-final').addEventListener('click', () => personalExport(true));
  $('export-draft').addEventListener('click', () => personalExport(false));
  $('restore-draft').addEventListener('click', () => $('restore-files').click());
  $('restore-files').addEventListener('change', (event) => {
    const [file] = event.target.files;
    event.target.value = '';
    if (file) void restoreBackup(file);
  });
  $('add-files').addEventListener('click', () => $('review-files').click());
  $('review-files').addEventListener('change', async (event) => {
    const files = [...event.target.files];
    event.target.value = '';
    $('add-files').disabled = true;
    try {
      await importReview(files);
    } finally {
      $('add-files').disabled = false;
    }
  });
  $('only-disagreements').addEventListener('change', renderReview);
  $('export-review').addEventListener('click', () => {
    if (received.size !== roles.length) return;
    exportRows('试点标注_全组六人汇总.csv', [headers, ...tales.flatMap((tale) =>
      roles.map((role) => exportRow(tale, role, received.get(role)[tale.khm])))]);
  });
  $('export-disagreements').addEventListener('click', () => {
    if (received.size !== roles.length) return;
    const columns = ['KHM', '篇名', ...comparisonFields.slice(1).map((key) => fieldLabel[key] + '（种类数）'), '结果', '已填人数', '分歧字段'];
    const rows = tales.map((tale) => {
      const { counts, conflictFields } = compare(tale);
      return [tale.khm, tale.title, ...counts.slice(1), conflictFields.length ? '分歧' : '一致',
        received.size, conflictFields.map((key) => fieldLabel[key]).join('、')];
    });
    exportRows('试点分歧_全组.csv', [columns, ...rows]);
  });
}

setup();
