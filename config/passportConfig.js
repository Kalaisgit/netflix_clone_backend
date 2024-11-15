import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import dotenv from "dotenv";

dotenv.config(); // Load environment variables

// Configure the Google OAuth strategy
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // Extract relevant user information
        const user = {
          id: profile.id,
          email: profile.emails[0].value,
          name: profile.displayName,
        };

        console.log("Authenticated user from Google:", user);

        // Pass the user object to the next middleware
        done(null, user);
      } catch (error) {
        console.error("Error in Google OAuth callback:", error);
        done(error, null); // Pass the error to Passport
      }
    }
  )
);

// Serialize the user into the session (store minimal data, e.g., Google ID)
passport.serializeUser((user, done) => {
  console.log("Serializing user:", user.id);
  done(null, user.id); // Store only the Google ID in the session
});

// Deserialize the user from the session
passport.deserializeUser((id, done) => {
  console.log("Deserializing user:", id);
  // Retrieve user details from the database if needed
  done(null, { id }); // Simplified for demonstration
});
