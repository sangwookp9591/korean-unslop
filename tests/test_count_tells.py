"""Run with: python3 -m unittest discover -s tests -p 'test_*.py'."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'skills/korean-unslop/scripts/count_tells.py'
spec = importlib.util.spec_from_file_location('count_tells', SCRIPT)
tells = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = tells
spec.loader.exec_module(tells)


class CountTellsTests(unittest.TestCase):
    repeated = '로그를 확인했습니다.\n설정을 수정했습니다.\n변경을 적용했습니다.\n결과를 검증했습니다.'

    def test_specific_endings_and_quoted_punctuation(self):
        for sentence, expected in [
            ('로그를 확인했습니다.”', '했습니다'),
            ('지금 처리됩니다!', '됩니다'),
            ('오늘 배포일입니다.', '입니다'),
            ('기록이 있습니다.', '있습니다'),
        ]:
            self.assertEqual(tells.ending_key(sentence), expected)

    def test_four_repeated_endings_include_start_line_and_all_outputs(self):
        rep = tells.analyze(self.repeated)
        expected = [{'ending': '했습니다', 'length': 4, 'start_line': 1}]
        self.assertEqual(tells.to_dict(rep)['ending_key_runs'], expected)
        self.assertIn("'했습니다' 4번 연속", tells.render(rep))
        self.assertIn('같은 종결형 4연속 이상 | 1 | 0',
                      tells.render_compare(rep, tells.analyze('완료했습니다.')))

    def test_mixed_endings_preserve_register_detection(self):
        rep = tells.analyze('완료했습니다. 배포됩니다. 정상입니다. 기록이 있습니다. 다시 확인했습니다.')
        self.assertEqual(rep.ending_key_runs, [])
        self.assertEqual(rep.ending_runs, [('합쇼체(~습니다)', 5, 1)])

    def test_boundary_interruption_and_empty_input(self):
        self.assertEqual(tells.analyze('완료했습니다. 확인했습니다. 수정했습니다.').ending_key_runs, [])
        interrupted = '완료했습니다. 확인했습니다. 정상입니다. 수정했습니다. 배포했습니다.'
        self.assertEqual(tells.analyze(interrupted).ending_key_runs, [])
        self.assertEqual(tells.analyze('').ending_key_runs, [])
        text = '정상입니다.\n' + self.repeated + '\n작업을 종료했습니다.'
        self.assertEqual(tells.analyze(text).ending_key_runs, [('했습니다', 5, 2)])

    def test_modifier_candidates_and_meta_phrases(self):
        modifiers = '궁극적으로 본질적으로 근본적으로 필연적으로 잠재적인 전반적인 성공적으로 효과적으로 적극적으로'
        rep = tells.analyze('앞부분은 그대로입니다.\n' + modifiers)
        self.assertEqual(len(rep.hits['D7']), 9)
        self.assertEqual({h.line for h in rep.hits['D7']}, {2})
        phrases = '주목할 만한 점은 눈여겨볼 부분은 중요한 포인트는 살펴보자면'
        self.assertEqual(len(tells.analyze(phrases).hits['A5']), 4)
        self.assertEqual(tells.analyze('효과와 비용을 비교했습니다.').hits['D7'], [])

    def test_cli_json_stdin(self):
        result = subprocess.run([sys.executable, str(SCRIPT), '-', '--json'],
                                input=self.repeated, text=True, capture_output=True, check=True)
        data = json.loads(result.stdout)
        self.assertEqual(data['ending_key_runs'][0]['ending'], '했습니다')
        self.assertIn('ending_runs', data)


if __name__ == '__main__':
    unittest.main()
