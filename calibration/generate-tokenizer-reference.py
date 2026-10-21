"""Maintainer-only synthetic fixture generation with official local tiktoken."""
import json
from pathlib import Path
import tiktoken
texts=['','a','Hello, world!','2 + 2 = 4','antidisestablishmentarianism','こんにちは世界','你好，世界','مرحبا بالعالم','नमस्ते दुनिया','Grüße aus Köln','😀🧑🏽‍💻🌍','e\u0301 é','\r\n\t spaces  ','<|endoftext|>','```python\nprint("hello")\n```','a' * 1000,'## Heading\n- one\n- two','\\u1234 is literal','Ω ≈ 3.14159','first\u0000last','Привет, мир','안녕하세요 세계','Token split boundary','foo@example.invalid','[link](https://example.invalid)','🇩🇪🇮🇳','中文文档与英文 mixed','SELECT * FROM records;','let x = [1,2,3];','résumé naïve façade']
cases=[{'id':f'edge-{i:02}','text':text,'group':'edge_cases','split':'training'} for i,text in enumerate(texts)]
groups={
 'english':('Explain the allocation of electricity for task number {i}.','A river survey contains {i} samples; report the missing measurements.'),
 'german':('Berechne die beobachtete Nutzung für Anfrage {i}.','Für Standort {i} fehlen Kühldaten; kennzeichne die Unsicherheit.'),
 'code':('def total_{i}(values):\n    return sum(values)\n','const record{i} = {{value: null, status: "unknown"}};'),
 'numeric':('Measurement {i}: 0.000001 kWh; 384.4 g/kWh; 3.1321 L/kWh.','[{i}, 9223372036854775807, 0.000000000000000001, -17.50]'),
 'unicode':('測定 {i} 😀 naïve e\u0301 مرحبا नमस्ते','🌍報告{i} 안녕하세요 κόσμος 🧑🏽‍💻')}
for group,(training,holdout) in groups.items():
    for i in range(74):
        split='holdout' if i>=54 else 'training'
        text=(holdout if split=='holdout' else training).format(i=i)
        if i%13==0:text='\n'.join([text]*300)
        cases.append({'id':f'{group}-{i:03}','text':text,'group':group,'split':split})
assert len(cases)==400 and sum(c['split']=='holdout' for c in cases)==100
for case in cases:case['counts']={encoding:len(tiktoken.get_encoding(encoding).encode_ordinary(case['text'])) for encoding in ('o200k_base','cl100k_base')}
data={'reference':'openai/tiktoken','version':tiktoken.__version__,'special_token_policy':'encode_ordinary','split_design':'Frozen before comparison: 300 training and 100 holdout; distinct holdout templates per language/content group. No fitting or mapping promotion. Long cases occur in both splits.','scope':'Synthetic supplied-text parity only; no consumer model mapping or request completeness validation','cases':cases}
Path(__file__).with_name('tokenizer-golden.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
