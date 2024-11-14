import express from "express";
import passport from "passport";
import session from "express-session";
import dotenv from "dotenv";
import "../config/passportConfig.js"; // Passport config for Google strategy
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

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
    failureRedirect: "/",
  }),
  async (req, res) => {
    const { name, email } = req.user._json; // Extracting from _json

    try {
      const { data, error } = await supabase.auth.signInWithProvider({
        provider: "google",
        email,
      });

      if (error) {
        console.error("Error signing in with Google:", error);
        return res.status(500).json({ message: "Login failed" });
      }

      // User data retrieved from Supabase
      const user = data.user;

      console.log("User signed in:", user);
    } catch (error) {
      console.error("Error signing in with Google:", error);
      return res.status(500).json({ message: "Login failed" });
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
  console.log("Received request to add favorite:", req.body); // Log incoming request data
  const { email, profile_id, movie_id, movie_poster, movie_title, movie_year } =
    req.body;

  if (!email || !profile_id || !movie_id) {
    return res
      .status(400)
      .json({ error: "Email, profile_id, and movie_id are required" });
  }

  try {
    // First, fetch the user based on the email
    const { data, error } = await supabase
      .from("users")
      .select("id") // Select user ID
      .eq("email", email)
      .single();

    if (error) {
      console.error("Error fetching user:", error);
      return res.status(500).json({ error: "Error adding favorite" });
    }

    const userId = data.id;

    // Check if the favorite already exists for this user_id and profile_id
    const { data: favoriteData, error: favoriteError } = await supabase
      .from("favorites")
      .select("*")
      .eq("user_id", userId)
      .eq("profile_id", profile_id)
      .eq("movie_id", movie_id)
      .single();

    if (favoriteError) {
      console.error("Error checking favorite:", favoriteError);
      return res.status(500).json({ error: "Error adding favorite" });
    }

    if (favoriteData) {
      return res
        .status(409)
        .json({ error: "This movie is already in favorites" });
    }

    // Insert the favorite as it does not already exist
    const { data: insertedFavorite, error: insertError } = await supabase
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
      ])
      .single();

    if (insertError) {
      console.error("Error inserting favorite:", insertError);
      return res.status(500).json({ error: "Error adding favorite" });
    }

    res.status(201).json(insertedFavorite); // Return the newly added favorite
  } catch (error) {
    console.error("Error adding favorite:", error);
    res
      .status(500)
      .json({ error: "An error occurred while adding the favorite" });
  }
});

// Remove a favorite movie
app.delete(`/favorites/:movie_id/:profile_id`, async (req, res) => {
  const { movie_id, profile_id } = req.params;

  if (!req.isAuthenticated() || req.user.profile_name === "Guest") {
    return res.status(403).json({ message: "Guests cannot remove favorites." });
  }

  try {
    // Find the user in the database
    const { data, error } = await supabase
      .from("users")
      .select("id")
      .eq("email", req.user.emails[0].value)
      .single();

    if (error) {
      console.error("Error fetching user:", error);
      return res
        .status(500)
        .json({ message: "Failed to remove favorite movie" });
    }

    const userId = data.id;

    // Delete the movie from the favorites table, using user_id, movie_id, and profile_id
    const { data: deletedData, error: deleteError } = await supabase
      .from("favorites")
      .delete()
      .eq("user_id", userId)
      .eq("movie_id", movie_id)
      .eq("profile_id", profile_id);

    if (deleteError) {
      console.error("Error deleting favorite:", deleteError);
      return res
        .status(500)
        .json({ message: "Failed to remove favorite movie" });
    }

    if (deletedData.length === 0) {
      return res.status(404).json({ message: "Favorite not found" });
    }

    res.status(200).json({ message: "Movie removed from favorites" });
  } catch (error) {
    console.error("Error removing favorite movie:", error);
    res.status(500).json({ message: "Failed to remove favorite movie" });
  }
});

// Get favorites for a specific profile of the authenticated user
app.get(`/favorites`, async (req, res) => {
  const { profile_id } = req.query;

  // Check if profile_id is provided
  if (!profile_id) {
    return res.status(400).json({ error: "Profile ID is required" });
  }

  try {
    // Query to get the user_id directly from the profiles table
    const { data, error } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("profile_id", profile_id)
      .single();

    if (error) {
      console.error("Error fetching user ID:", error);
      return res.status(500).json({ error: "Error fetching favorites" });
    }

    const userId = data.user_id;
    console.log("Profile ID:", profile_id, "User ID:", userId);

    // Query favorites specific to profile_id and user_id
    const { data: favoritesData, error: favoritesError } = await supabase
      .from("favorites")
      .select("*")
      .eq("profile_id", profile_id)
      .eq("user_id", userId);

    if (favoritesError) {
      console.error("Error fetching favorites:", favoritesError);
      return res.status(500).json({ error: "Error fetching favorites" });
    }

    if (favoritesData.length === 0) {
      return res
        .status(404)
        .json({ error: "No favorites found for this profile" });
    }

    res.json(favoritesData);
  } catch (error) {
    console.error("Error fetching favorites:", error);
    res
      .status(500)
      .json({ error: "An error occurred while fetching favorites" });
  }
});

// Get user by email
app.get(`/users`, async (req, res) => {
  const { email } = req.query;

  try {
    const { data, error } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .single();

    if (error) {
      console.error("Error fetching user:", error);
      return res.status(500).json({ message: "Internal server error" });
    }

    if (!data) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json(data); // Return the user ID
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Add a profile
app.post(`/profiles`, async (req, res) => {
  console.log(req.body); // Log the incoming request body
  const { user_id, profile_name } = req.body; // Expect user_id here

  try {
    const { data, error } = await supabase
      .from("profiles")
      .insert([{ user_id, profile_name }])
      .single();

    if (error) {
      console.error("Error adding profile:", error);
      return res.status(500).json({ message: "Failed to add profile" });
    }

    res.status(201).json(data); // Return the newly created profile
  } catch (error) {
    console.error("Error adding profile:", error); // Log the error
    res.status(500).json({ message: "Failed to add profile" });
  }
});

// Get profiles for the authenticated user
app.get(`/profiles`, async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(403).json({ message: "User not authenticated" });
  }

  const email = req.user.emails[0].value; // Get the authenticated user's email

  try {
    const { data, error } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .single();

    if (error) {
      console.error("Error fetching user:", error);
      return res.status(500).json({ message: "Internal server error" });
    }

    const userId = data.id;

    const { data: profilesData, error: profilesError } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", userId);

    if (profilesError) {
      console.error("Error fetching profiles:", profilesError);
      return res.status(500).json({ message: "Internal server error" });
    }

    res.status(200).json(profilesData); // Return the profiles
  } catch (error) {
    console.error("Error fetching profiles:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Handle deleting a profile
app.delete(`/profiles/:id`, async (req, res) => {
  const { id } = req.params; // Extract profile ID from the URL
  try {
    // Add your logic to delete the profile from the database
    const { data, error } = await supabase
      .from("profiles")
      .delete()
      .eq("profile_id", id);

    if (error) {
      console.error("Error deleting profile:", error);
      return res.status(500).json({ message: "Failed to delete profile" });
    }

    if (data.length === 0) {
      return res.status(404).json({ message: "Profile not found" });
    }

    res.status(200).json({ message: "Profile deleted successfully" });
  } catch (error) {
    console.error("Error deleting profile:", error);
    res.status(500).json({ message: "Failed to delete profile" });
  }
});

app.put(`/profiles`, async (req, res) => {
  const { profile_id, profile_name } = req.body;

  if (!profile_id || !profile_name) {
    return res
      .status(400)
      .json({ message: "Profile ID and name are required." });
  }

  try {
    // Update the profile in the database
    const { data, error } = await supabase
      .from("profiles")
      .update({ profile_name })
      .eq("profile_id", profile_id)
      .single();

    if (error) {
      console.error("Error updating profile:", error);
      return res.status(500).json({ message: "Error updating profile." });
    }

    if (!data) {
      return res.status(404).json({ message: "Profile not found." });
    }

    res.status(200).json(data); // Return the updated profile
  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).json({ message: "Error updating profile." });
  }
});

export default app;
