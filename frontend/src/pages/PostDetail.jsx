import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { API_BASE } from '../api'
import { useStore } from '../store/zustandStore'
import EssayCard from '../components/EssayCard'
import { IconButton } from '../components/Icons'

function CommentCard({ comment, onVote }) {
  const [score, setScore] = useState(comment.score || 0)
  const [votes, setVotes] = useState({ upvotes: comment.upvotes || 0, downvotes: comment.downvotes || 0 })
  const [userVote, setUserVote] = useState(comment.user_vote || null)

  const handleVote = async (value) => {
    const nextValue = userVote === value ? 0 : value
    const result = await onVote(comment.id, nextValue)
    if (result) {
      setScore(result.score)
      setVotes({ upvotes: result.upvotes, downvotes: result.downvotes })
      setUserVote(result.user_vote)
    }
  }

  return (
    <div className="rounded-xl border border-dark-border bg-dark-card p-4">
      <div className="flex gap-4">
        <div className="flex flex-col items-center gap-1">
          <button onClick={() => handleVote(1)} className={userVote === 1 ? 'text-primary' : 'text-gray-500 hover:text-primary'}>▲</button>
          <span className="text-sm font-semibold">{score}</span>
          <button onClick={() => handleVote(-1)} className={userVote === -1 ? 'text-swiss-blue' : 'text-gray-500 hover:text-swiss-blue'}>▼</button>
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="text-xs text-gray-500">
            <span className="font-semibold text-primary">{comment.username}</span>
            <span className="mx-2">•</span>
            <span>{new Date(comment.created_at).toLocaleString()}</span>
          </div>
          <p className="whitespace-pre-wrap break-words text-base leading-relaxed">{comment.content}</p>
          <p className="text-xs text-gray-500">{votes.upvotes} ▲ {votes.downvotes} ▼</p>
        </div>
      </div>
    </div>
  )
}

export default function PostDetail() {
  const { postId } = useParams()
  const navigate = useNavigate()
  const { user } = useStore()
  const [post, setPost] = useState(null)
  const [comments, setComments] = useState([])
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const loadPost = async () => {
    setLoading(true)
    setError('')
    try {
      const userParam = user.id ? `?current_user_id=${user.id}` : ''
      const [postRes, commentsRes] = await Promise.all([
        fetch(`${API_BASE}/essays/${postId}${userParam}`),
        fetch(`${API_BASE}/essays/${postId}/comments${userParam}`),
      ])
      const postData = await postRes.json()
      const commentsData = await commentsRes.json()
      if (!postRes.ok) throw new Error(postData.error || 'Post not found')
      if (!commentsRes.ok) throw new Error(commentsData.error || 'Comments could not be loaded')
      setPost(postData)
      setComments(commentsData.comments || [])
    } catch (err) {
      setError(err.message || 'Post could not be loaded')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPost()
  }, [postId, user.id])

  const submitComment = async (event) => {
    event.preventDefault()
    if (!user.username || !content.trim()) return
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/essays/${postId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username, content: content.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Comment failed')
      setComments((items) => [...items, data])
      setPost((current) => current ? { ...current, comment_count: (current.comment_count || 0) + 1 } : current)
      setContent('')
    } catch (err) {
      setError(err.message || 'Comment failed')
    } finally {
      setSubmitting(false)
    }
  }

  const voteComment = async (commentId, value) => {
    if (!user.username) return null
    const res = await fetch(`${API_BASE}/essays/comments/${commentId}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.username, value }),
    })
    return res.json()
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-dark-border bg-dark-bg/95 p-4 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <IconButton onClick={() => navigate('/feed')} icon="back" label="Back to feed" />
          <h1 className="text-sm font-semibold">Discussion</h1>
          <IconButton onClick={() => navigate('/profile')} icon="profile" label="Profile" />
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-6 px-4 py-6">
        {loading ? (
          <div className="py-12 text-center text-gray-500">Loading...</div>
        ) : error && !post ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600">{error}</div>
        ) : post ? (
          <>
            <EssayCard essay={post} />

            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold">Comments</h2>
                <span className="text-sm text-gray-500">{comments.length}</span>
              </div>

              {user.username ? (
                <form onSubmit={submitComment} className="space-y-3 rounded-xl border border-dark-border bg-dark-card p-4">
                  {error && <p className="text-sm text-red-600">{error}</p>}
                  <textarea
                    value={content}
                    onChange={(event) => setContent(event.target.value.slice(0, 1000))}
                    placeholder="Add to the discussion..."
                    rows={4}
                    className="w-full resize-none rounded-xl border border-dark-border bg-dark-bg px-4 py-3 focus:border-primary focus:outline-none"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">{content.length}/1000</span>
                    <IconButton type="submit" icon="send" label={submitting ? 'Posting' : 'Post comment'} disabled={submitting || content.trim().length < 2} className="icon-button-primary" />
                  </div>
                </form>
              ) : (
                <div className="rounded-xl border border-dark-border bg-dark-card p-4 text-sm text-gray-500">
                  Log in or continue as guest to comment and vote.
                </div>
              )}

              <div className="space-y-3">
                {comments.length === 0 ? (
                  <div className="rounded-xl border border-dark-border bg-dark-card p-5 text-center text-sm text-gray-500">No comments yet</div>
                ) : (
                  comments.map((comment) => <CommentCard key={comment.id} comment={comment} onVote={voteComment} />)
                )}
              </div>
            </section>
          </>
        ) : null}
      </main>
    </div>
  )
}
