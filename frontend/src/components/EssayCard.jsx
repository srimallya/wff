import { useState } from 'react'
import { useStore } from '../store/zustandStore'

export default function EssayCard({ essay }) {
  const { user, voteEssay } = useStore()
  const [localScore, setLocalScore] = useState(essay.score || 0)
  const [localVotes, setLocalVotes] = useState({
    upvotes: essay.upvotes || 0,
    downvotes: essay.downvotes || 0,
  })
  const [userVote, setUserVote] = useState(essay.user_vote || null)

  const handleVote = async (value) => {
    if (!user.username) return
    const newValue = userVote === value ? 0 : value
    const result = await voteEssay(essay.id, newValue)
    if (result) {
      setLocalScore(result.score)
      setLocalVotes({ upvotes: result.upvotes, downvotes: result.downvotes })
      setUserVote(result.user_vote)
    }
  }

  return (
    <div className="bg-dark-card border border-dark-border rounded-xl p-5">
      <div className="flex gap-4">
        <div className="flex flex-col items-center gap-1 pt-1">
          <button
            onClick={() => handleVote(1)}
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
            onClick={() => handleVote(-1)}
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
          <p className="text-base leading-relaxed whitespace-pre-wrap">{essay.content}</p>
          <div className="flex items-center justify-end text-xs text-gray-600">
            <span>{localVotes.upvotes} ▲ {localVotes.downvotes} ▼</span>
          </div>
        </div>
      </div>
    </div>
  )
}
