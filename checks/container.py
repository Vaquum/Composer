"""Build the application image; propagate Docker's actual exit status."""
import subprocess
import sys

sys.exit(subprocess.run(['docker', 'build', '-t', 'composer:check', '.'], check=False).returncode)
