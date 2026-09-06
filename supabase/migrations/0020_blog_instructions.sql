-- Free-text guidance the blog agent always follows (continuous improvement loop):
-- what to fix, what to know about the client, what/how to write.
alter table client_wordpress add column if not exists blog_instructions text;
