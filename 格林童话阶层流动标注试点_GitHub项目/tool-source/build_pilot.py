import csv
import difflib
import io
import json
import re
import secrets
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path
from zipfile import ZipFile

from openpyxl import load_workbook


work = Path(__file__).resolve().parent
project = work.parent
if len(sys.argv) == 1:
    workbook_path = project / 'sources' / 'CUS6043 格林童话阶层流动标注表.xlsx'
    corpus_path = project / 'sources' / 'grimm_hunt_corpus.zip'
    target = project / 'index.html'
elif len(sys.argv) == 4:
    workbook_path, corpus_path, target = map(Path, sys.argv[1:])
else:
    raise SystemExit('Usage: python build_pilot.py [workbook.xlsx corpus.zip index.html]')

book = load_workbook(workbook_path, read_only=True, data_only=True)
pilot = defaultdict(list)
pilot_rows = list(book['试点标注'].values)
for khm, title, annotator, *rest in pilot_rows[1:]:
    assert all(value in (None, '') for value in rest)
    pilot[(str(khm), title)].append(annotator)
assert len(pilot) == 20
assert all(roles == [f'组员{role}' for role in 'ABCDEF'] for roles in pilot.values())

guide = [list(row) for row in list(book['编码说明'].values)[1:] if row[0]]
options = list(zip(*book['Dropdown options'].values))
book.close()
chinese_titles = {
    '1': '青蛙国王，又名铁亨利',
    '2': '猫和老鼠合伙过日子',
    '12': '莴苣姑娘（拉庞泽尔）',
    '15': '汉塞尔和格蕾特尔',
    '19': '渔夫和他的妻子',
    '20': '勇敢的小裁缝',
    '21': '灰姑娘',
    '29': '有三根金发的魔鬼',
    '52': '画眉嘴国王',
    '53': '白雪公主',
    '55': '侏儒怪伦佩尔施蒂尔茨金',
    '63': '三根羽毛',
    '64': '金鹅',
    '65': '千皮兽',
    '77': '聪明的格蕾特尔',
    '83': '幸运的汉斯',
    '89': '牧鹅姑娘',
    '94': '农夫聪明的女儿',
    '101': '熊皮人',
    '153': '星星银币',
}
fields = [
    {'key': key, 'label': label, 'options': [value for value in options[col] if value is not None] if col is not None else None}
    for key, label, col in zip(('app', 'person', 'gender', 'start', 'end', 'movement', 'method', 'notes'), pilot_rows[0][3:], (2, None, 1, 3, 3, 4, 0, None))
]

def normalize_title(value):
    return re.sub(r'[\W_]+', '', unicodedata.normalize('NFKD', value).casefold())


def read_translation(khm, paragraph_count):
    path = work / 'translations' / f'{khm}.zh.txt'
    lines = path.read_text(encoding='utf-8-sig').splitlines()
    if len(lines) != paragraph_count:
        raise ValueError(f'{path.name}: expected {paragraph_count} paragraphs, got {len(lines)}')
    translation = []
    for number, line in enumerate(lines, 1):
        marker, _, chinese = line.partition('\t')
        if marker != str(number) or not re.search(r'[\u3400-\u9fff]', chinese):
            raise ValueError(f'{path.name}: invalid Chinese paragraph {number}')
        translation.append(chinese.strip())
    return translation


tales = []
with ZipFile(corpus_path) as corpus:
    stats = list(csv.DictReader(io.StringIO(corpus.read('tales_stats.csv').decode('utf-8-sig'))))
    by_khm = {item['khm']: item for item in stats}
    for khm, title in pilot:
        row = by_khm[khm]
        raw = corpus.read('tales/' + row['file']).decode('utf-8-sig').strip()
        source_title, body = raw.split('\n', 1)
        expected = normalize_title(title)
        assert expected == normalize_title(row['title']), (khm, title, row['title'])
        assert difflib.SequenceMatcher(None, expected, normalize_title(source_title)).ratio() >= .8, (title, source_title)
        paragraphs = [line.strip() for line in body.splitlines() if line.strip()]
        assert paragraphs
        tales.append({
            'khm': khm,
            'title': title,
            'titleZh': chinese_titles[khm],
            'file': row['file'],
            'paragraphs': paragraphs,
            'paragraphsZh': read_translation(khm, len(paragraphs)),
        })

assignment_path = work / 'assignments.json'
if assignment_path.exists():
    people = json.loads(assignment_path.read_text(encoding='utf-8'))
else:
    names = ['袁嘉伟', '钱思娴', '陈思益', '刘亚洲', '伊思遥', '张思贤']
    secrets.SystemRandom().shuffle(names)
    people = dict(zip('ABCDEF', names))
    assignment_path.write_text(json.dumps(people, ensure_ascii=False), encoding='utf-8')

data = {'people': people, 'tales': tales, 'guide': guide, 'fields': fields, 'headers': list(pilot_rows[0])}
template = (work / 'pilot.html').read_text(encoding='utf-8')
for key, value in [('__PILOT_DATA__', json.dumps(data, ensure_ascii=False).replace('<', '\\u003c')),
                   ('__PILOT_CSS__', (work / 'pilot.css').read_text(encoding='utf-8')),
                   ('__PILOT_JS__', (work / 'pilot.js').read_text(encoding='utf-8'))]:
    assert template.count(key) == 1
    template = template.replace(key, value)
target.write_text(template, encoding='utf-8', newline='\n')
print(json.dumps(people, ensure_ascii=True))
print(f'{len(tales)} tales; {sum(len(t["paragraphs"]) for t in tales)} paragraphs; {target.stat().st_size} bytes')
