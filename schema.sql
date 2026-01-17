DROP TABLE IF EXISTS feedback;
CREATE TABLE feedback (id INTEGER PRIMARY KEY, customer_text TEXT, sentiment TEXT, summary TEXT);
INSERT INTO feedback (customer_text) VALUES 
('The login page keeps crashing when I use Firefox. It is super frustrating!'),
('I love the new dark mode, it looks amazing. Great job team!'),
('The API documentation is outdated and very confusing.');