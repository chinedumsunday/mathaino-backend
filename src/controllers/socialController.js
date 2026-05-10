const prisma = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(iso) {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return '';
  const h = parseInt(match[1] || 0), m = parseInt(match[2] || 0), s = parseInt(match[3] || 0);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatViews(count) {
  const n = parseInt(count || 0, 10);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

const USER_SELECT = { id: true, firstName: true, lastName: true, avatarUrl: true, role: true };

// ── Social Feed ───────────────────────────────────────────────────────────────

// GET /api/social/feed?page=1&limit=20
const getFeed = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1'));
  const limit = Math.min(50, parseInt(req.query.limit || '20'));
  const skip = (page - 1) * limit;
  const userId = req.user.id;

  const [posts, total] = await Promise.all([
    prisma.socialPost.findMany({
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: USER_SELECT },
        likes: { select: { userId: true } },
        comments: {
          take: 3,
          orderBy: { createdAt: 'desc' },
          include: { user: { select: USER_SELECT } },
        },
        _count: { select: { likes: true, comments: true } },
      },
    }),
    prisma.socialPost.count(),
  ]);

  const formatted = posts.map(p => ({
    ...p,
    likedByMe: p.likes.some(l => l.userId === userId),
    likes: undefined,
  }));

  res.json({ success: true, data: { posts: formatted, total, page, pages: Math.ceil(total / limit) } });
});

// POST /api/social/posts
const createPost = asyncHandler(async (req, res) => {
  const { body, youtubeId, imageUrl, instagramUrl } = req.body;
  if (!body?.trim() && !youtubeId && !imageUrl && !instagramUrl) {
    throw ApiError.badRequest('Post must have text, an image, a YouTube video, or an Instagram link');
  }

  const post = await prisma.socialPost.create({
    data: {
      userId: req.user.id,
      body: body?.trim() || '',
      youtubeId: youtubeId || null,
      imageUrl: imageUrl || null,
      instagramUrl: instagramUrl || null,
    },
    include: {
      user: { select: USER_SELECT },
      _count: { select: { likes: true, comments: true } },
    },
  });

  res.status(201).json({ success: true, data: { post: { ...post, likedByMe: false, comments: [] } } });
});

// DELETE /api/social/posts/:id
const deletePost = asyncHandler(async (req, res) => {
  const post = await prisma.socialPost.findUnique({ where: { id: req.params.id } });
  if (!post) throw ApiError.notFound('Post not found');
  if (post.userId !== req.user.id && !['FACULTY', 'SUPER_ADMIN'].includes(req.user.role)) {
    throw ApiError.forbidden('Not allowed');
  }
  await prisma.socialPost.delete({ where: { id: req.params.id } });
  res.json({ success: true, message: 'Post deleted' });
});

// POST /api/social/posts/:id/like  (toggle)
const toggleLike = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const existing = await prisma.socialLike.findUnique({ where: { postId_userId: { postId: id, userId } } });

  if (existing) {
    await prisma.socialLike.delete({ where: { postId_userId: { postId: id, userId } } });
  } else {
    await prisma.socialLike.create({ data: { postId: id, userId } });
  }

  const count = await prisma.socialLike.count({ where: { postId: id } });
  res.json({ success: true, data: { liked: !existing, count } });
});

// GET /api/social/posts/:id/comments
const getComments = asyncHandler(async (req, res) => {
  const comments = await prisma.socialComment.findMany({
    where: { postId: req.params.id },
    orderBy: { createdAt: 'asc' },
    include: { user: { select: USER_SELECT } },
  });
  res.json({ success: true, data: { comments } });
});

// POST /api/social/posts/:id/comments
const addComment = asyncHandler(async (req, res) => {
  const { body } = req.body;
  if (!body?.trim()) throw ApiError.badRequest('Comment cannot be empty');

  const comment = await prisma.socialComment.create({
    data: { postId: req.params.id, userId: req.user.id, body: body.trim() },
    include: { user: { select: USER_SELECT } },
  });

  res.status(201).json({ success: true, data: { comment } });
});

// DELETE /api/social/comments/:id
const deleteComment = asyncHandler(async (req, res) => {
  const comment = await prisma.socialComment.findUnique({ where: { id: req.params.id } });
  if (!comment) throw ApiError.notFound('Comment not found');
  if (comment.userId !== req.user.id && !['FACULTY', 'SUPER_ADMIN'].includes(req.user.role)) {
    throw ApiError.forbidden('Not allowed');
  }
  await prisma.socialComment.delete({ where: { id: req.params.id } });
  res.json({ success: true, message: 'Comment deleted' });
});

// ── YouTube Search ─────────────────────────────────────────────────────────────

const youtubeSearch = asyncHandler(async (req, res) => {
  const { q = 'computer science tutorial' } = req.query;
  const apiKey = process.env.YOUTUBE_API_KEY;

  if (!apiKey || apiKey === 'AIza...') {
    return res.json({ success: true, data: { videos: [], configured: false } });
  }

  const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&type=video&maxResults=10&key=${apiKey}&relevanceLanguage=en&safeSearch=moderate`;
  const searchRes = await fetch(searchUrl);
  if (!searchRes.ok) return res.json({ success: true, data: { videos: [], configured: true } });

  const searchData = await searchRes.json();
  const items = searchData.items || [];
  if (!items.length) return res.json({ success: true, data: { videos: [], configured: true } });

  const videoIds = items.map(i => i.id.videoId).join(',');
  const detailsRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails,statistics&id=${videoIds}&key=${apiKey}`);
  const detailsData = detailsRes.ok ? await detailsRes.json() : { items: [] };
  const dm = {};
  (detailsData.items || []).forEach(i => { dm[i.id] = { duration: formatDuration(i.contentDetails?.duration || ''), views: formatViews(i.statistics?.viewCount) }; });

  const videos = items.map(item => ({
    id: item.id.videoId,
    title: item.snippet.title,
    channel: item.snippet.channelTitle,
    thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || null,
    duration: dm[item.id.videoId]?.duration || '',
    views: dm[item.id.videoId]?.views || '',
  }));

  res.json({ success: true, data: { videos, configured: true } });
});

module.exports = { getFeed, createPost, deletePost, toggleLike, getComments, addComment, deleteComment, youtubeSearch };
