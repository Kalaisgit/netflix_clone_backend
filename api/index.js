import express from "express";
import passport from "passport";
import session from "express-session";
import dotenv from "dotenv";
import "../config/passportConfig.js"; // Passport config for Google strategy
import cors from "cors"; // Import the cors package
import { createClient } from "@supabase/supabase-js"; // Import the Supabase client

dotenv.config();

const app = express();

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL, // Your Supabase project URL
  process.env.SUPABASE_KEY // Your Supabase API Key
);

// Middleware
app.use(express.json()); // To parse JSON requests
app.use(
  cors({
    origin: process.env.FRONTEND_URL, // Adjust this to match your frontend URL
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
  `/auth/google`,
  passport.authenticate("google", { scope: ["profile", "email"] })
);

app.get(
  `/auth/google/callback`,
  passport.authenticate("google", {
    failureRedirect: process.env.FRONTEND_URL,
  }),
  async (req, res) => {
    const { name, email } = req.user._json; // Extracting from _json

    try {
      // Check if user already exists
      const { data: userResult, error } = await supabase
        .from("users")
        .select("user_id")
        .eq("email", email);

      if (userResult.length === 0) {
        // If the user doesn't exist, insert them into the users table
        const { data: newUser, error: insertError } = await supabase
          .from("users")
          .insert([{ email, name }]);

        if (insertError) {
          console.error("Error adding user to database:", insertError);
        } else {
          console.log("New user added:", email, name);
        }
      } else {
        console.log("User already exists:", email);
      }
    } catch (error) {
      console.error("Error adding user to database:", error);
    }

    res.redirect(`${process.env.FRONTEND_URL}`);
  }
);

// Check if user is authenticated
app.get(`/auth/status`, (req, res) => {
  if (req.isAuthenticated()) {
    res.json({
      authenticated: true,
      email: req.user.emails[0].value,
    });
  } else {
    res.json({ authenticated: false });
  }
});

app.post(`/auth/logout`, (req, res) => {
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
app.post(`/favorites`, async (req, res) => {
  const { email, profile_id, movie_id, movie_poster, movie_title, movie_year } =
    req.body;

  if (!email || !profile_id || !movie_id) {
    return res
      .status(400)
      .json({ error: "Email, profile_id, and movie_id are required" });
  }

  try {
    const { data: userResult, error } = await supabase
      .from("users")
      .select("user_id")
      .eq("email", email);

    if (userResult.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userId = userResult[0].user_id;

    const { data: checkResult } = await supabase
      .from("favorites")
      .select("*")
      .eq("user_id", userId)
      .eq("profile_id", profile_id)
      .eq("movie_id", movie_id);

    if (checkResult.length > 0) {
      return res
        .status(409)
        .json({ error: "This movie is already in favorites" });
    }

    const { data: newFavorite, error: insertError } = await supabase
      .from("favorites")
      .insert([
        {
          user_id: userId,
          profile_id,
          movie_id,
          movie_poster,
          movie_title,
          movie_year,
        },
      ]);

    if (insertError) {
      console.error("Error adding favorite:", insertError);
      return res.status(500).json({ error: "Error adding favorite" });
    }

    res.status(201).json(newFavorite[0]);
  } catch (error) {
    console.error("Error adding favorite:", error);
    res
      .status(500)
      .json({ error: "An error occurred while adding the favorite" });
  }
});

// Get favorites for a specific profile
app.get(`/favorites`, async (req, res) => {
  const { profile_id } = req.query;

  if (!profile_id) {
    return res.status(400).json({ error: "Profile ID is required" });
  }

  try {
    const { data: userResult, error } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("profile_id", profile_id);

    if (userResult.length === 0) {
      return res.status(404).json({ error: "No user found for this profile" });
    }

    const user_id = userResult[0].user_id;

    const { data: result, error: fetchError } = await supabase
      .from("favorites")
      .select("*")
      .eq("profile_id", profile_id)
      .eq("user_id", user_id);

    if (fetchError) {
      console.error("Error fetching favorites:", fetchError);
      return res
        .status(500)
        .json({ error: "An error occurred while fetching favorites" });
    }

    if (result.length === 0) {
      return res
        .status(404)
        .json({ error: "No favorites found for this profile" });
    }

    res.json(result);
  } catch (error) {
    console.error("Error fetching favorites:", error);
    res
      .status(500)
      .json({ error: "An error occurred while fetching favorites" });
  }
});

export default app;
