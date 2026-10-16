import sys


def test_python_runtime():
    assert sys.version_info >= (3, 12)
