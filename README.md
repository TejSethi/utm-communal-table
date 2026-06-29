# UTM Communal Table 
This web application provides a platform for the students to donate their surplus food to other students in need.

## Visit The Site
If you would like to view the project, [click here!](https://utm-communal-table.web.app/)

## Prerequisites
Before running this project locally, please ensure you have the following installed:
- Code editor like VS Code for example
- Node.js and npm (Node Package Manager)
- Firebase
- Firebase CLI

## Installation 
1. Clone the repository
2. ```bash
   npm install
   ```
3. Set Up Firebase
Create a Firebase project and enable the following services:
   - Firebase Authentication
   - Firebase Firestore
   - Firebase Hosting
4. Run The Project Locally
   ```bash
   npx serve public 
   ```
5. Open `public/index.html` in your browser

## Features 
- User signup and login
- Food board (updates current inventory dynamically) 
- Cart system
- Food claiming (includes tracking interface)
- Food impact page (i.e. point redemption system)
- User profile and account management page
- Firebase Firestore Database

## Usage 
After opening the website, users can create an account or login to their existing account. We have two different work flows. One for donating food, and the other one for claiming food.
For food donor workflow, this consists of:
- Signup and login
- Enter food posting details and submit the food
- Collect points when users claim donated food
- Redeem points for coffee
For food receiver workflow, this consists of:
- Signup and login
- Explore available food on food board
- View food details
- Add food to cart
- Claim food
- View claim tracking and history
Users can also visit their profile / account management page to view / modify their information. 
