const env = require("dotenv").config();
const serverless = require("serverless-http");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const app = express();
const port = 5000;
const saltRounds = 10;
const jwtSecret = process.env.JWT_SECRET;

// Middleware
app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI);

// Check connection
mongoose.connection.once("open", () => {
  console.log("Connected to MongoDB");
});

const UserSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  followersCount: { type: Number, default: 0 },
  followingCount: { type: Number, default: 0 },
  followersList: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  followingList: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  postsCount: { type: Number, default: 0 },
  postsList: [{ type: mongoose.Schema.Types.ObjectId, ref: "Post" }], // Assuming there's a Post model
});

const User = mongoose.model("User", UserSchema);

const PostSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  content: String,
  createdAt: { type: Date, default: Date.now },
});

const Post = mongoose.model("Post", PostSchema);

// Routes

app.post("/follow/:id", async (req, res) => {
  const { userId } = req.body;
  try {
    const userToFollow = await User.findById(req.params.id);
    const userFollowing = await User.findById(userId);
    if (!userToFollow || !userFollowing) {
      return res.status(404).json({ message: "User not found" });
    }
    if (!userToFollow.followersList.includes(userId)) {
      // Follow the user

      userToFollow.followersList.push(userId);

      userToFollow.followersCount = userToFollow.followersList.length;
      userFollowing.followingList.push(userToFollow._id);
      userFollowing.followingCount = userFollowing.followingList.length;

      await userToFollow.save();
      await userFollowing.save();
      res.json({
        message: "User followed successfully",
        followedUser: userToFollow,
      });
    } else {
      // Unfollow the user

      userToFollow.followersList = userToFollow.followersList.filter(
        (followerId) => followerId.toString() !== userId.toString()
      );

      userToFollow.followersCount -= Math.max(
        0,
        userToFollow.followersCount - 1
      );

      userFollowing.followingList = userFollowing.followingList.filter(
        (followingId) => followingId.toString() !== userToFollow._id.toString()
      );
      userFollowing.followingCount = Math.max(
        0,
        userFollowing.followingCount - 1
      );

      await userToFollow.save();
      await userFollowing.save();
      res.json({ message: "User unfollowed successfully" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/user/:id/posts", async (req, res) => {
  try {
    const user = await User.findById(req.params.id).populate({
      path: "postsList",
      populate: {
        path: "user",
        model: "User",
      },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user.postsList);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/register", async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const newUser = new User({
      name,
      email,
      password: hashedPassword,
      followersCount: 0,
      followingCount: 0,
      followersList: [],
      followingList: [],
      postsCount: 0,
      postsList: [],
    });
    await newUser.save();
    res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
// Get all users
app.get("/users", async (req, res) => {
  try {
    const users = await User.find(
      {},
      "name followingCount user._id followersList"
    );
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/userStatus", async (req, res) => {
  try {
    const { q } = req.query;
    const currentUserId = q;
    const users = await User.find(
      {},
      "name followingCount followersList user._id  followersCount followingList"
    );
    const result = users
      .filter((user) => user._id.toString() !== q) // Filtering out the current user
      .map((user) => {
        const isFollowing = user.followersList.includes(currentUserId);
        return {
          _id: user._id,
          name: user.name,
          followingCount: user.followingCount,
          isFollowing: isFollowing,
          profileImageUrl: user.profileImageUrl,
          followersList: user.followersList,
          followersCount: user.followersCount,
          followingList: user.followingList,
        };
      });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/user/:id/feed", async (req, res) => {
  try {
    //  Get the current user's ID
    const userId = req.params.id;

    //  Find the current user and get their following list
    const currentUser = await User.findById(userId);
    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const followingList = currentUser.followingList;

    //  Fetch posts from users in the following list, and sort them by createdAt field
    const feedPosts = await Post.find({
      user: { $in: followingList },
    })
      .populate("user", "name profileImageUrl")
      .sort({ createdAt: -1 }) // Sort posts by the timestamp in descending order
      .exec();

    //  Return the sorted posts as the feed
    res.json(feedPosts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/user/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .populate("followersList", "name email followingCount followingList")
      .populate("followingList", "name email followingCount ")
      .populate("postsList");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/posts", async (req, res) => {
  const { userId, content } = req.body;

  if (!userId || !content || content.length > 100) {
    return res.status(400).json({ message: "Invalid post data" });
  }

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const newPost = new Post({
      user: userId,
      content,
    });

    const savedPost = await newPost.save();

    user.postsList.push(savedPost._id);
    user.postsCount = user.postsList.length;

    await user.save();

    // Return the created post along with the user info
    res.status(201).json({
      message: "Post created successfully",
      post: savedPost,
      user: {
        id: user._id,
        name: user.name,
        postsCount: user.postsCount,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Login route
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    const token = jwt.sign({ userId: user._id }, jwtSecret, {
      expiresIn: "1h",
    });
    res.json({
      token,
      user: {
        name: user.name,
        email: user.email,
        id: user._id,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/", async (req, res) => {
  res.send("Server is running");
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
module.exports.handler = serverless(app);
