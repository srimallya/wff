from flask import Blueprint, request, jsonify
from backend.models import db, Essay, PolicyProposal

proposals_bp = Blueprint('wff_proposals', __name__)

@proposals_bp.route('', methods=['GET'])
def get_proposals():
    essays = Essay.query.filter(Essay.is_policy_proposal == True).all()

    category_counts = {}
    year_counts = {}

    for essay in essays:
        if essay.policy_proposal:
            cat = essay.policy_proposal.category or 'uncategorized'
            category_counts[cat] = category_counts.get(cat, 0) + 1

        year = essay.target_calendar_year
        year_key = f"{year // 10 * 10}s"
        year_counts[year_key] = year_counts.get(year_key, 0) + 1

    grouped_proposals = {}
    for essay in essays:
        year_key = f"{essay.target_calendar_year // 10 * 10}"
        if year_key not in grouped_proposals:
            grouped_proposals[year_key] = {
                'year_range': f"{year_key}-{int(year_key) + 9}",
                'essays': [],
                'count': 0
            }

        grouped_proposals[year_key]['essays'].append({
            'id': essay.id,
            'username': essay.author.username if essay.author else 'Unknown',
            'content': essay.content[:200] + '...' if len(essay.content) > 200 else essay.content,
            'target_calendar_year': essay.target_calendar_year,
            'category': essay.policy_proposal.category if essay.policy_proposal else None
        })
        grouped_proposals[year_key]['count'] += 1

    return jsonify({
        'grouped': list(grouped_proposals.values()),
        'category_counts': category_counts,
        'year_counts': year_counts,
        'total': len(essays)
    })

@proposals_bp.route('/extract', methods=['POST'])
def extract_proposal():
    data = request.get_json()
    essay_id = data.get('essay_id')

    essay = Essay.query.get_or_404(essay_id)

    keywords = {
        'education': ['education', 'school', 'curriculum', 'teacher', 'university', 'learning'],
        'economy': ['economy', 'work', 'jobs', 'business', 'income', 'tax', 'trade'],
        'environment': ['environment', 'climate', 'river', 'forest', 'ocean', 'energy', 'pollution'],
        'health': ['health', 'hospital', 'doctor', 'medicine', 'care', 'public health'],
        'governance': ['government', 'election', 'law', 'justice', 'constitution', 'rights', 'policy']
    }

    detected_category = None
    for category, words in keywords.items():
        for word in words:
            if word in essay.content:
                detected_category = category
                break
        if detected_category:
            break

    summary = essay.content[:150] + '...' if len(essay.content) > 150 else essay.content

    proposal = PolicyProposal(
        essay_id=essay.id,
        extracted_summary=summary,
        category=detected_category
    )

    essay.is_policy_proposal = True
    db.session.add(proposal)
    db.session.commit()

    return jsonify({
        'proposal_id': proposal.id,
        'category': proposal.category,
        'extracted_summary': proposal.extracted_summary
    }), 201
