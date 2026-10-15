"""Backend selection tests run on any OS without downloading a model or torch."""
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from reranker_device import select_device


def fake_torch(cuda=False, mps=False, has_mps=True):
    backends = SimpleNamespace()
    if has_mps:
        backends.mps = SimpleNamespace(is_available=lambda: mps)
    return SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: cuda), backends=backends)


class DeviceSelection(unittest.TestCase):
    def test_cuda(self):
        self.assertEqual(select_device(fake_torch(cuda=True, mps=True)), 'cuda')

    def test_apple_silicon(self):
        self.assertEqual(select_device(fake_torch(mps=True)), 'mps')

    def test_intel_or_unavailable_mps(self):
        self.assertEqual(select_device(fake_torch()), 'cpu')
        self.assertEqual(select_device(fake_torch(has_mps=False)), 'cpu')

    def test_force_cpu(self):
        self.assertEqual(select_device(fake_torch(cuda=True, mps=True), 'cpu'), 'cpu')

    def test_unsupported_explicit_device(self):
        with self.assertRaisesRegex(ValueError, 'MPS is unavailable'):
            select_device(fake_torch(), 'mps')
        with self.assertRaisesRegex(ValueError, 'CUDA is unavailable'):
            select_device(fake_torch(), 'cuda')
        with self.assertRaises(ValueError):
            select_device(fake_torch(), 'invalid')


if __name__ == '__main__':
    unittest.main()
