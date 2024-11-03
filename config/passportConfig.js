import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import dotenv from "dotenv";

dotenv.config(); // Load the .env file

// Configure the Google OAuth strategy
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
    },
    (accessToken, refreshToken, profile, done) => {
      // This callback is called after Google authenticates the user
      // You can use the profile info (Google ID, name, etc.) to identify the user
      // For now, we'll just log the profile and pass it to `done`
      console.log("Google profile:", profile);
      done(null, profile); // Pass profile to next middleware
    }
  )
);

// Serialize the user for the session
passport.serializeUser((user, done) => {
  done(null, user);
});

// Deserialize the user from the session
passport.deserializeUser((user, done) => {
  done(null, user);
});
