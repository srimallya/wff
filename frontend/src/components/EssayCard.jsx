import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/zustandStore'
import RichText from './RichText'
import { copyTextToClipboard, postShareUrl } from '../shareLinks'

export default function EssayCard({ essay }) {
  const navigate = useNavigate()
  const { user, voteEssay } = useStore()
  const [localScore, setLocalScore] = useState(essay.score || 0)
  const [localVotes, setLocalVotes] = useState({
    upvotes: essay.upvotes || 0,
    downvotes: essay.downvotes || 0,
  })
  const [userVote, setUserVote] = useState(essay.user_vote || null)
  const [copied, setCopied] = useState(false)

  const handleVote = async (event, value) => {
    event.stopPropagation()
    if (!user.username) return
    const newValue = userVote === value ? 0 : value
    const result = await voteEssay(essay.id, newValue)
    if (result) {
      setLocalScore(result.score)
      setLocalVotes({ upvotes: result.upvotes, downvotes: result.downvotes })
      setUserVote(result.user_vote)
    }
  }

  const handleShare = async (event) => {
    event.stopPropagation()
    if (essay.is_pending) return
    const url = postShareUrl(essay.id)
    const didCopy = await copyTextToClipboard(url)
    if (didCopy) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }
  }

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => !essay.is_pending && navigate(`/posts/${essay.id}`)}
      onKeyDown={(event) => {
        if (!essay.is_pending && (event.key === 'Enter' || event.key === ' ')) navigate(`/posts/${essay.id}`)
      }}
      className="border-t border-dark-border py-5 cursor-pointer transition"
    >
      <div className="flex gap-4">
        <div className="flex flex-col items-center gap-1 pt-1">
          <button
            onClick={(event) => handleVote(event, 1)}
            disabled={!user.username}
            className={`text-lg font-bold transition-colors ${
              userVote === 1 ? 'text-primary' : 'text-gray-500 hover:text-gray-300'
            } disabled:opacity-30`}
          >
            ▲
          </button>
          <span className={`text-sm font-semibold ${
            userVote === 1 ? 'text-primary' : userVote === -1 ? 'text-blue-400' : 'text-gray-300'
          }`}>
            {localScore}
          </span>
          <button
            onClick={(event) => handleVote(event, -1)}
            disabled={!user.username}
            className={`text-lg font-bold transition-colors ${
              userVote === -1 ? 'text-blue-400' : 'text-gray-500 hover:text-gray-300'
            } disabled:opacity-30`}
          >
            ▼
          </button>
        </div>

        <div className="flex-1 space-y-3 min-w-0">
          <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500">
            <span className="text-primary font-medium">{essay.username}</span>
            {essay.is_pending && (
              <>
                <span>•</span>
                <span className="text-primary">Posting...</span>
              </>
            )}
            <span>•</span>
            <span>{essay.country || 'Global'}</span>
            <span>•</span>
            <span>age {essay.target_age ?? 'n/a'} in scenario</span>
            <span>•</span>
            <span>{essay.target_calendar_year}</span>
          </div>
          {essay.title && (
            <h2 className="essay-card-title">{essay.title}</h2>
          )}
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            <RichText text={essay.content} />
          </p>
          <div className="flex items-center justify-between gap-4 text-xs text-gray-600">
            <button
              type="button"
              onClick={handleShare}
              disabled={essay.is_pending}
              className="swiss-action disabled:opacity-30"
            >
              {copied ? 'Copied' : 'Share'}
            </button>
            <span>{localVotes.upvotes} ▲ {localVotes.downvotes} ▼</span>
            <span className="ml-3">{essay.comment_count || 0} comments</span>
          </div>
        </div>
      </div>
    </article>
  )
}
