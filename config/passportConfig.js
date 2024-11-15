import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import dotenv from "dotenv";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

dotenv.config();

const supabase = createSupabaseClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
    },
    function (token, tokenSecret, profile, done) {
      // Interact with Supabase here with the initialized supabase client
      supabase
        .from("users")
        .upsert({
          id: profile.id,
          email: profile.emails[0].value,
          name: profile.displayName,
        })
        .then(({ data, error }) => {
          if (error) return done(error, null);
          done(null, data[0]);
        });
    }
  )
);

// Configure Passport to serialize and deserialize user info
passport.serializeUser((user, done) => {
  done(null, user.id); // Store only the user ID in session
});

passport.deserializeUser((id, done) => {
  // Fetch user from database by ID (you can use Supabase here)
  supabase
    .from("users")
    .select("*")
    .eq("id", id)
    .single()
    .then(({ data, error }) => {
      if (error) {
        done(error, null);
      } else {
        done(null, data);
      }
    });
});
