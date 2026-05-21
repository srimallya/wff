import { useEffect, useMemo, useState } from 'react'
import { API_BASE } from '../api'

const typeStyles = {
  user: { fill: '#111111', stroke: '#111111', radius: 8 },
  post: { fill: '#e30613', stroke: '#e30613', radius: 7 },
  comment: { fill: '#6b6f76', stroke: '#6b6f76', radius: 5 },
  country: { fill: '#fbfbf8', stroke: '#111111', radius: 7 },
  year: { fill: '#fbfbf8', stroke: '#e30613', radius: 7 },
}

const columns = {
  user: 80,
  post: 235,
  comment: 390,
  country: 545,
  year: 545,
}

function nodeY(node, index, counts) {
  const total = Math.max(1, counts[node.type] || 1)
  const slot = 360 / (total + 1)
  const offset = node.type === 'year' ? 18 : 0
  return 55 + slot * (index + 1) + offset
}

function truncate(label, length = 28) {
  if (!label) return ''
  return label.length > length ? `${label.slice(0, length - 1)}...` : label
}

export default function NetworkMap() {
  const [graph, setGraph] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setError('')
      try {
        const res = await fetch(`${API_BASE}/essays/graph`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Map unavailable')
        if (!cancelled) setGraph(data)
      } catch (err) {
        if (!cancelled) setError(err.message || 'Map unavailable')
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const layout = useMemo(() => {
    if (!graph) return { nodes: [], edges: [] }
    const counts = graph.nodes.reduce((acc, node) => {
      acc[node.type] = (acc[node.type] || 0) + 1
      return acc
    }, {})
    const indexByType = {}
    const nodes = graph.nodes.map((node) => {
      const index = indexByType[node.type] || 0
      indexByType[node.type] = index + 1
      const y = nodeY(node, index, counts)
      const x = columns[node.type] || 315
      return { ...node, x, y }
    })
    const byId = Object.fromEntries(nodes.map((node) => [node.id, node]))
    const edges = graph.edges
      .map((edge) => ({ ...edge, sourceNode: byId[edge.source], targetNode: byId[edge.target] }))
      .filter((edge) => edge.sourceNode && edge.targetNode)
    return { nodes, edges }
  }, [graph])

  if (error) {
    return <p className="border-l border-primary pl-3 text-sm text-red-500">{error}</p>
  }

  if (!graph) {
    return <div className="py-12 text-center text-sm text-gray-500">Loading map...</div>
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-4 border-b border-dark-border pb-4 text-center text-xs text-gray-500">
        <div><span className="block text-base text-swiss-black">{graph.counts.users}</span>users</div>
        <div><span className="block text-base text-swiss-black">{graph.counts.posts}</span>posts</div>
        <div><span className="block text-base text-swiss-black">{graph.counts.relations}</span>links</div>
      </div>

      <div className="overflow-x-auto border-b border-dark-border pb-4">
        <svg viewBox="0 0 640 460" className="min-w-[640px]">
          <g stroke="#d9d9d2" strokeWidth="1">
            {layout.edges.map((edge, index) => (
              <line
                key={`${edge.source}-${edge.target}-${edge.relation}-${index}`}
                x1={edge.sourceNode.x}
                y1={edge.sourceNode.y}
                x2={edge.targetNode.x}
                y2={edge.targetNode.y}
                stroke={edge.relation === 'friends' ? '#111111' : '#d9d9d2'}
                strokeDasharray={edge.relation === 'friends' ? '0' : '4 5'}
              />
            ))}
          </g>
          {layout.nodes.map((node) => {
            const style = typeStyles[node.type] || typeStyles.comment
            const labelX = node.type === 'country' || node.type === 'year' ? node.x + 13 : node.x - 13
            const anchor = node.type === 'country' || node.type === 'year' ? 'start' : 'end'
            return (
              <g key={node.id}>
                <circle cx={node.x} cy={node.y} r={style.radius} fill={style.fill} stroke={style.stroke} strokeWidth="1.5" />
                <text x={labelX} y={node.y + 4} textAnchor={anchor} fontSize="10" fill="#4b5563">
                  {truncate(node.label)}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      <div className="grid grid-cols-2 gap-x-5 gap-y-2 text-xs text-gray-500">
        <p><span className="text-swiss-black">Black</span> users and friendships</p>
        <p><span className="text-primary">Red</span> posts and target years</p>
        <p>Grey dots are comments and replies</p>
        <p>Outlined dots are countries and years</p>
      </div>
    </div>
  )
}
