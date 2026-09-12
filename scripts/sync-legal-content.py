"""Regenerate the website legal asset from canonical Obsidian documents."""
from pathlib import Path
import json

source = Path('/Users/menjunyi/Library/Mobile Documents/iCloud~md~obsidian/Documents/Obsidian/Junyi AI OS/11 Company/Proairesis AI/Projects/01 - Pip AI Job Search/landing-page/legal')
slugs = ('cookie-notice', 'terms-and-conditions', 'privacy-policy', 'membership-agreement', 'disclaimer', 'refund-and-cancellation-policy')
content = {slug: (source / f'{slug}.md').read_text() for slug in slugs}
output = Path(__file__).resolve().parents[1] / 'lib/legal-content.ts'
output.write_text('// Generated from the canonical legal Markdown in Obsidian.\n// Source: ' + str(source) + '\nexport const legalContent: Record<string, string> = ' + json.dumps(content, ensure_ascii=False, indent=2) + ';\n')
print('Regenerated six legal page contents from Obsidian.')
