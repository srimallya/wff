from html import escape
from urllib.parse import urlsplit

from flask import Blueprint, Response, jsonify, request

from backend.models import Essay, NowStory, User, db


share_bp = Blueprint('wff_share', __name__)


def _base_path():
    script_root = (request.script_root or '').rstrip('/')
    if script_root:
        return script_root
    path = request.path or ''
    for marker in ('/api/share/', '/share/'):
        marker_index = path.find(marker)
        if marker_index > 0:
            return path[:marker_index].rstrip('/')
    return ''


def _absolute_url(path):
    base = _base_path()
    return f'{request.url_root.rstrip("/")}{base}{path}'


def _truncate(value, limit=240):
    text = ' '.join((value or '').split())
    if len(text) <= limit:
        return text
    return f'{text[:limit].rsplit(" ", 1)[0].rstrip()}...'


def _share_page(title, description, canonical_path, app_path, meta_type='article'):
    canonical = _absolute_url(canonical_path)
    app_url = _absolute_url(app_path)
    safe_title = escape(title or 'World Foresight Forum')
    safe_description = escape(description or 'A public post on World Foresight Forum.')
    safe_canonical = escape(canonical)
    safe_app_url = escape(app_url)
    html = f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{safe_title}</title>
  <meta name="description" content="{safe_description}">
  <meta property="og:title" content="{safe_title}">
  <meta property="og:description" content="{safe_description}">
  <meta property="og:type" content="{escape(meta_type)}">
  <meta property="og:url" content="{safe_canonical}">
  <meta name="twitter:card" content="summary">
  <style>
    :root {{ color-scheme: dark; }}
    body {{
      margin: 0;
      background: #1f1f1d;
      color: #f4f4ef;
      font-family: "Avenir Next", Avenir, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.5;
    }}
    main {{
      max-width: 42rem;
      margin: 0 auto;
      padding: 4rem 1.25rem;
    }}
    .kicker {{
      color: #a9aaa4;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }}
    h1 {{
      margin: 0.75rem 0 1.25rem;
      font-size: clamp(2rem, 6vw, 4.5rem);
      line-height: 0.95;
      letter-spacing: 0;
    }}
    p {{
      color: #d9d9d2;
      font-size: 1.05rem;
      white-space: pre-wrap;
    }}
    a {{
      color: #e30613;
      text-decoration: underline;
      text-underline-offset: 0.2em;
    }}
    .actions {{
      display: flex;
      flex-wrap: wrap;
      gap: 1.25rem;
      margin-top: 2rem;
      border-top: 1px solid #73736d;
      padding-top: 1.25rem;
    }}
  </style>
</head>
<body>
  <main>
    <div class="kicker">World Foresight Forum</div>
    <h1>{safe_title}</h1>
    <p>{safe_description}</p>
    <div class="actions">
      <a href="{safe_app_url}">Open in WFF</a>
      <a href="{escape(_absolute_url("/"))}">Continue as guest</a>
    </div>
  </main>
</body>
</html>'''
    return Response(html, mimetype='text/html')


def _essay_share_payload(essay):
    author = db.session.get(User, essay.user_id)
    title = essay.title or f'Post by {author.username if author else "WFF"}'
    description = _truncate(essay.content)
    return {
        'kind': 'post',
        'id': essay.id,
        'title': title,
        'description': description,
        'share_path': f'/share/posts/{essay.id}',
        'app_path': f'/posts/{essay.id}',
    }


def _story_share_payload(story):
    return {
        'kind': 'now',
        'id': story.id,
        'title': story.title,
        'description': _truncate(story.summary),
        'share_path': f'/share/now/{story.id}',
        'app_path': f'/now?story={story.id}',
    }


def _strip_base_path(path):
    base = _base_path()
    if base and path.startswith(f'{base}/'):
        return path[len(base):]
    if path.startswith('/wff/'):
        return path[4:]
    return path


def _payload_for_path(path):
    normalized = _strip_base_path(path or '')
    parts = [part for part in normalized.split('/') if part]
    if len(parts) == 3 and parts[:2] == ['share', 'posts'] and parts[2].isdigit():
        essay = db.session.get(Essay, int(parts[2]))
        return _essay_share_payload(essay) if essay else None
    if len(parts) == 3 and parts[:2] == ['share', 'now'] and parts[2].isdigit():
        story = db.session.get(NowStory, int(parts[2]))
        return _story_share_payload(story) if story else None
    return None


@share_bp.route('/share/posts/<int:essay_id>', methods=['GET'])
def share_post(essay_id):
    essay = db.get_or_404(Essay, essay_id)
    payload = _essay_share_payload(essay)
    return _share_page(payload['title'], payload['description'], payload['share_path'], payload['app_path'])


@share_bp.route('/share/now/<int:story_id>', methods=['GET'])
def share_now_story(story_id):
    story = db.get_or_404(NowStory, story_id)
    payload = _story_share_payload(story)
    return _share_page(payload['title'], payload['description'], payload['share_path'], payload['app_path'])


@share_bp.route('/api/share/resolve', methods=['GET'])
def resolve_share_url():
    raw_url = (request.args.get('url') or '').strip()
    if not raw_url:
        return jsonify({'error': 'url is required'}), 400
    try:
        parsed = urlsplit(raw_url)
    except ValueError:
        return jsonify({'error': 'Invalid URL'}), 400
    path = parsed.path if parsed.scheme else raw_url
    payload = _payload_for_path(path)
    if not payload:
        return jsonify({'error': 'Share URL not found'}), 404
    payload['url'] = _absolute_url(payload['share_path'])
    return jsonify(payload)
