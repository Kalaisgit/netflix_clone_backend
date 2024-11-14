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
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Middleware
app.use(express.json());
app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
  })
);

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
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
    const { name, email } = req.user._json; // Extracting name and email from the Google profile

    try {
      // Check if the user already exists in the 'users' table
      const { data: userResult, error: selectError } = await supabase
        .from("users")
        .select("user_id")
        .eq("email", email);

      if (selectError) {
        console.error("Error checking user in database:", selectError);
        return res.status(500).json({ message: "Internal Server Error" });
      }

      // If the user does not exist, insert the user into the 'users' table
      if (userResult.length === 0) {
        const { data: newUser, error: insertError } = await supabase
          .from("users")
          .insert([{ email, name }]);

        if (insertError) {
          console.error("Error adding user to database:", insertError);
          return res
            .status(500)
            .json({ message: "Failed to add user to the database" });
        } else {
          console.log("New user added:", email, name);
        }
      } else {
        console.log("User already exists:", email);
      }

      // Redirect to the frontend application
      res.redirect("/");
    } catch (error) {
      console.error("Error during Google callback:", error);
      return res.status(500).json({ message: "Login failed" });
    }
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
    const { data, error } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .single();

    if (error) {
      console.error("Error fetching user:", error);
      return res.status(500).json({ error: "Error adding favorite" });
    }

    const userId = data.id;

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

    res.status(201).json(insertedFavorite);
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

  if (!profile_id) {
    return res.status(400).json({ error: "Profile ID is required" });
  }

  try {
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

    res.status(200).json(data);
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Add a profile
app.post(`/profiles`, async (req, res) => {
  const { user_id, profile_name } = req.body;

  try {
    const { data, error } = await supabase
      .from("profiles")
      .insert([{ user_id, profile_name }])
      .single();

    if (error) {
      console.error("Error adding profile:", error);
      return res.status(500).json({ message: "Failed to add profile" });
    }

    res.status(201).json(data);
  } catch (error) {
    console.error("Error adding profile:", error);
    res.status(500).json({ message: "Failed to add profile" });
  }
});

// Get profiles for the authenticated user
app.get(`/profiles`, async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(403).json({ message: "User not authenticated" });
  }

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", req.user.id);

    if (error) {
      console.error("Error fetching profiles:", error);
      return res.status(500).json({ message: "Error fetching profiles" });
    }

    res.status(200).json(data);
  } catch (error) {
    console.error("Error fetching profiles:", error);
    res.status(500).json({ message: "Error fetching profiles" });
  }
});

// Update a profile
app.put(`/profiles/:profile_id`, async (req, res) => {
  const { profile_id } = req.params;
  const { profile_name } = req.body;

  try {
    const { data, error } = await supabase
      .from("profiles")
      .update({ profile_name })
      .eq("profile_id", profile_id)
      .single();

    if (error) {
      console.error("Error updating profile:", error);
      return res.status(500).json({ message: "Failed to update profile" });
    }

    res.status(200).json({ message: "Profile updated", profile: data });
  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).json({ message: "Failed to update profile" });
  }
});

// Delete a profile
app.delete(`/profiles/:profile_id`, async (req, res) => {
  const { profile_id } = req.params;

  try {
    const { data, error } = await supabase
      .from("profiles")
      .delete()
      .eq("profile_id", profile_id)
      .single();

    if (error) {
      console.error("Error deleting profile:", error);
      return res.status(500).json({ message: "Failed to delete profile" });
    }

    res.status(200).json({ message: "Profile deleted", profile: data });
  } catch (error) {
    console.error("Error deleting profile:", error);
    res.status(500).json({ message: "Failed to delete profile" });
  }
});

export default app;
