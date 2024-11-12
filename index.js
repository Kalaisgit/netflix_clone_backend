import express from "express";
import passport from "passport";
import session from "express-session";
import dotenv from "dotenv";
import "./config/passportConfig.js"; // Passport config for Google strategy
import cors from "cors"; // Import the cors package
import pg from "pg"; // Using PostgreSQL db

dotenv.config();

const app = express();
const db = new pg.Client({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// Connect to PostgreSQL database
db.connect((err) => {
  if (err) {
    console.error("Connection error", err.stack);
  } else {
    console.log("Connected to the PostgreSQL database");
  }
});

// Middleware
app.use(express.json()); // To parse JSON requests
app.use(
  cors({
    origin: process.env.FRONT_END_URL, // Adjust this to match your frontend URL
    credentials: true, // Allow cookies to be sent with requests
  })
);

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false, // Don't save empty sessions
    cookie: { secure: false },
  })
);

app.use(passport.initialize());
app.use(passport.session());

// Google Authentication Routes
app.get(
  "/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

app.get(
  "/auth/google/callback",
  passport.authenticate("google", {
    failureRedirect: process.env.FRONT_END_URL,
  }),
  async (req, res) => {
    const { name, email } = req.user._json; // Extracting from _json

    try {
      const userResult = await db.query(
        "SELECT user_id FROM users WHERE email = $1",
        [email]
      );

      if (userResult.rows.length === 0) {
        // If the user doesn't exist, insert them into the users table
        await db.query("INSERT INTO users (email, name) VALUES ($1, $2)", [
          email,
          name,
        ]);
        console.log("New user added:", email, name);
      } else {
        console.log("User already exists:", email);
      }
    } catch (error) {
      console.error("Error adding user to database:", error);
    }

    res.redirect(process.env.FRONT_END_URL);
  }
);

// Check if user is authenticated
app.get("/auth/status", (req, res) => {
  if (req.isAuthenticated()) {
    res.json({
      authenticated: true,
      email: req.user.emails[0].value,
    });
  } else {
    res.json({ authenticated: false });
  }
});

app.post("/auth/logout", (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(403).json({ message: "User not authenticated" });
  }

  req.logout((err) => {
    if (err) {
      return res.status(500).json({ message: "Logout failed" });
    }
    res.status(200).json({ message: "Logged out successfully" });
  });
});

// Add a favorite movie
app.post("/favorites", async (req, res) => {
  console.log("Received request to add favorite:", req.body); // Log incoming request data
  const { email, profile_id, movie_id, movie_poster, movie_title, movie_year } =
    req.body;

  if (!email || !profile_id || !movie_id) {
    return res
      .status(400)
      .json({ error: "Email, profile_id, and movie_id are required" });
  }

  try {
    // First, fetch the user_id from the users table based on the email
    const userQuery = "SELECT user_id FROM users WHERE email = $1";
    const userResult = await db.query(userQuery, [email]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userId = userResult.rows[0].user_id;

    // Check if the favorite already exists for this user_id and profile_id
    const checkQuery = `
      SELECT * FROM favorites 
      WHERE user_id = $1 AND profile_id = $2 AND movie_id = $3`;
    const checkResult = await db.query(checkQuery, [
      userId,
      profile_id,
      movie_id,
    ]);

    if (checkResult.rows.length > 0) {
      return res
        .status(409)
        .json({ error: "This movie is already in favorites" });
    }

    // Insert the favorite as it does not already exist
    const insertQuery = `
      INSERT INTO favorites (user_id, profile_id, movie_id, movie_poster, movie_title, movie_year)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`;
    const values = [
      userId,
      profile_id,
      movie_id,
      movie_poster,
      movie_title,
      movie_year,
    ];

    const result = await db.query(insertQuery, values);

    res.status(201).json(result.rows[0]); // Return the newly added favorite
  } catch (error) {
    console.error("Error adding favorite:", error);
    res
      .status(500)
      .json({ error: "An error occurred while adding the favorite" });
  }
});

// Remove a favorite movie
app.delete("/favorites/:movie_id/:profile_id", async (req, res) => {
  const { movie_id, profile_id } = req.params;

  if (!req.isAuthenticated() || req.user.profile_name === "Guest") {
    return res.status(403).json({ message: "Guests cannot remove favorites." });
  }

  try {
    // Find the user in the database
    const userResult = await db.query(
      "SELECT user_id FROM users WHERE email = $1",
      [req.user.emails[0].value]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const userId = userResult.rows[0].user_id;

    // Delete the movie from the favorites table, using user_id, movie_id, and profile_id
    const deleteResult = await db.query(
      "DELETE FROM favorites WHERE user_id = $1 AND movie_id = $2 AND profile_id = $3",
      [userId, movie_id, profile_id]
    );

    if (deleteResult.rowCount === 0) {
      return res.status(404).json({ message: "Favorite not found" });
    }

    res.status(200).json({ message: "Movie removed from favorites" });
  } catch (error) {
    console.error("Error removing favorite movie:", error);
    res.status(500).json({ message: "Failed to remove favorite movie" });
  }
});

// Get favorites for a specific profile of the authenticated user
app.get("/favorites", async (req, res) => {
  const { profile_id } = req.query;

  // Check if profile_id is provided
  if (!profile_id) {
    return res.status(400).json({ error: "Profile ID is required" });
  }

  try {
    // Query to get the user_id directly from the profiles table
    const userQuery = "SELECT user_id FROM profiles WHERE profile_id = $1";
    const userResult = await db.query(userQuery, [profile_id]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "No user found for this profile" });
    }

    const user_id = userResult.rows[0].user_id;
    console.log("Profile ID:", profile_id, "User ID:", user_id);

    // Query favorites specific to profile_id and user_id
    const query =
      "SELECT * FROM favorites WHERE profile_id = $1 AND user_id = $2";
    const values = [profile_id, user_id];
    const result = await db.query(query, values);

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ error: "No favorites found for this profile" });
    }

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching favorites:", error);
    res
      .status(500)
      .json({ error: "An error occurred while fetching favorites" });
  }
});

// Get user by email
app.get("/users", async (req, res) => {
  const { email } = req.query;

  try {
    const result = await db.query(
      "SELECT user_id FROM users WHERE email = $1",
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json(result.rows[0]); // Return the user ID
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Add a profile
app.post("/profiles", async (req, res) => {
  console.log(req.body); // Log the incoming request body
  const { user_id, profile_name } = req.body; // Expect user_id here

  try {
    const result = await db.query(
      "INSERT INTO profiles (user_id, profile_name) VALUES ($1, $2) RETURNING *",
      [user_id, profile_name]
    );

    res.status(201).json(result.rows[0]); // Return the newly created profile
  } catch (error) {
    console.error("Error adding profile:", error); // Log the error
    res.status(500).json({ message: "Failed to add profile" });
  }
});

// Get profiles for the authenticated user
app.get("/profiles", async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(403).json({ message: "User not authenticated" });
  }

  const email = req.user.emails[0].value; // Get the authenticated user's email

  try {
    const userResult = await db.query(
      "SELECT user_id FROM users WHERE email = $1",
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const userId = userResult.rows[0].user_id;

    const profilesResult = await db.query(
      "SELECT * FROM profiles WHERE user_id = $1",
      [userId]
    );

    res.status(200).json(profilesResult.rows); // Return the profiles
  } catch (error) {
    console.error("Error fetching profiles:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Handle deleting a profile
app.delete("/profiles/:id", async (req, res) => {
  const { id } = req.params; // Extract profile ID from the URL
  try {
    // Add your logic to delete the profile from the database
    const result = await db.query(
      "DELETE FROM profiles WHERE profile_id = $1",
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Profile not found" });
    }

    res.status(200).json({ message: "Profile deleted successfully" });
  } catch (error) {
    console.error("Error deleting profile:", error);
    res.status(500).json({ message: "Failed to delete profile" });
  }
});

app.put("/profiles", async (req, res) => {
  const { profile_id, profile_name } = req.body;

  if (!profile_id || !profile_name) {
    return res
      .status(400)
      .json({ message: "Profile ID and name are required." });
  }

  try {
    // Update the profile in the database
    const result = await db.query(
      "UPDATE profiles SET profile_name = $1 WHERE profile_id = $2 RETURNING *",
      [profile_name, profile_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Profile not found." });
    }

    res.status(200).json(result.rows[0]); // Return the updated profile
  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).json({ message: "Error updating profile." });
  }
});

// Start the server
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
